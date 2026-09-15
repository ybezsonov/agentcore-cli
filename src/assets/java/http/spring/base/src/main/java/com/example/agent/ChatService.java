package com.example.agent;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.springaicommunity.agentcore.annotation.AgentCoreInvocation;
import org.springaicommunity.agentcore.context.AgentCoreContext;
import org.springaicommunity.agentcore.context.AgentCoreHeaders;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

@Service
public class ChatService {

    private final ChatClient chatClient;

    public ChatService(
            ChatClient.Builder builder,
            List<ToolCallbackProvider> tools,
            @Value("${agent.system-prompt}") String systemPrompt) {
        this.chatClient = builder
            .defaultSystem(systemPrompt)
            .defaultTools(tools.toArray())
            .build();
    }

    /**
     * Streams one {@code {"text": "..."}} object per token and ends a failed stream with one
     * {@code {"error": "..."}} object.
     */
    @AgentCoreInvocation
    public Flux<ChatChunk> chat(ChatRequest request, AgentCoreContext context) {
        String actor = firstNonBlank(context.getHeader(AgentCoreHeaders.USER_ID), "default-user");
        String session = firstNonBlank(context.getHeader(AgentCoreHeaders.SESSION_ID), "default-session");
        String conversationId = actor + ":" + session;

        return chatClient.prompt()
            .user(request.prompt())
            .advisors(advisors -> advisors.param(ChatMemory.CONVERSATION_ID, conversationId))
            .stream()
            .content()
            .map(ChatChunk::ofText)
            .onErrorResume(error -> Flux.just(ChatChunk.ofError(error)));
    }

    /** One streamed token, or the terminal error. Null fields are not serialized. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ChatChunk(String text, String error) {

        static ChatChunk ofText(String text) {
            return new ChatChunk(text, null);
        }

        static ChatChunk ofError(Throwable error) {
            String message = error.getMessage();
            return new ChatChunk(null, message == null || message.isBlank() ? error.getClass().getSimpleName() : message);
        }
    }

    private static String firstNonBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
