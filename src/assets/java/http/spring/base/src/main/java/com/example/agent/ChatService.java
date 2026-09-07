package com.example.agent;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springaicommunity.agentcore.annotation.AgentCoreInvocation;
import org.springaicommunity.agentcore.context.AgentCoreContext;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

/**
 * Core agent service — written once, never edited as capabilities are added. It builds a
 * {@link ChatClient} from whatever the enabled capabilities contribute: individual {@link Advisor}
 * beans (e.g. a KB advisor), {@link AdvisorBundle}s (e.g. the memory capability's grouped advisors),
 * and {@link ToolCallbackProvider}s (e.g. a gateway MCP client). With no capabilities all collections
 * are empty and it is a plain Bedrock chat agent. The conversation id (for memory keying) is resolved
 * by the pluggable {@link ConversationIdProvider}.
 */
@Service
public class ChatService {

    private static final Logger logger = LoggerFactory.getLogger(ChatService.class);

    private final ChatClient chatClient;
    private final ConversationIdProvider conversationIdProvider;

    public ChatService(
            ChatClient.Builder chatClientBuilder,
            List<Advisor> advisors,
            List<AdvisorBundle> advisorBundles,
            List<ToolCallbackProvider> toolProviders,
            ConversationIdProvider conversationIdProvider,
            @Value("${agent.system-prompt}") String systemPrompt) {

        this.conversationIdProvider = conversationIdProvider;

        // A LinkedHashSet preserves order and de-duplicates anything exposed both individually and
        // via a bundle.
        Set<Advisor> all = new LinkedHashSet<>(advisors);
        for (AdvisorBundle bundle : advisorBundles) {
            all.addAll(bundle.advisors());
        }

        this.chatClient = chatClientBuilder
            .defaultSystem(systemPrompt)
            .defaultAdvisors(all.toArray(new Advisor[0]))
            .defaultTools(toolProviders.toArray())
            .build();
    }

    @AgentCoreInvocation
    public Flux<String> chat(ChatRequest request, AgentCoreContext context) {
        String conversationId = conversationIdProvider.resolve(context);
        return chatClient.prompt()
            .user(request.prompt())
            .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, conversationId))
            .stream()
            .content()
            .onErrorResume(error -> {
                logger.error("Chat stream failed", error);
                return Flux.just("\n\n[The request could not be completed. Please try again.]");
            });
    }
}
