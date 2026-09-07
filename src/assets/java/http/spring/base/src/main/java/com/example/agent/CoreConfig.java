package com.example.agent;

import java.util.UUID;

import org.springaicommunity.agentcore.context.AgentCoreHeaders;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Core beans that are always present. Capabilities may override these (e.g. the memory capability
 * contributes a {@code @Primary} {@link ConversationIdProvider}).
 */
@Configuration
public class CoreConfig {

    /** Default conversation id = the runtime session id, or a random id when none is present. */
    @Bean
    ConversationIdProvider defaultConversationIdProvider() {
        return context -> {
            String sessionId = context.getHeader(AgentCoreHeaders.SESSION_ID);
            return (sessionId == null || sessionId.isBlank()) ? UUID.randomUUID().toString() : sessionId;
        };
    }
}
