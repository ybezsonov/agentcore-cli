package com.example.agent;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springaicommunity.agentcore.annotation.AgentCoreInvocation;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

/**
 * Core agent service — written once, never edited as capabilities are added. It builds a
 * {@link ChatClient} from whatever the enabled capabilities contribute ({@link Advisor} beans such
 * as memory/RAG, {@link ToolCallbackProvider}s such as a gateway MCP client) and streams the model
 * response. With no capabilities, both lists are empty and it is a plain Bedrock chat agent.
 */
@Service
public class ChatService {

    private static final Logger logger = LoggerFactory.getLogger(ChatService.class);

    private final ChatClient chatClient;

    public ChatService(
            ChatClient.Builder chatClientBuilder,
            List<Advisor> advisors,
            List<ToolCallbackProvider> toolProviders,
            @Value("${agent.system-prompt}") String systemPrompt) {
        this.chatClient = chatClientBuilder
            .defaultSystem(systemPrompt)
            .defaultAdvisors(advisors.toArray(new Advisor[0]))
            .defaultTools(toolProviders.toArray())
            .build();
    }

    @AgentCoreInvocation
    public Flux<String> chat(ChatRequest request) {
        return chatClient.prompt()
            .user(request.prompt())
            .stream()
            .content()
            .onErrorResume(error -> {
                logger.error("Chat stream failed", error);
                return Flux.just("\n\n[The request could not be completed. Please try again.]");
            });
    }
}
