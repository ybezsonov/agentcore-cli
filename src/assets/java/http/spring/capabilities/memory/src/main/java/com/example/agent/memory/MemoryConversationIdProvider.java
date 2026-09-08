package com.example.agent.memory;

import java.util.Base64;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springaicommunity.agentcore.context.AgentCoreContext;
import org.springaicommunity.agentcore.context.AgentCoreHeaders;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import com.example.agent.ConversationIdProvider;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Memory-aware {@link ConversationIdProvider}: derives a {@code userId:sessionId}
 * composite from the JWT subject so memory is keyed per user. Registered as {@code @Primary} so it
 * overrides the core default (which keys on the session id alone). Active only when the memory
 * capability is configured (same {@code agentcore.memory.memory-id} gate as {@code MemoryConfig}).
 */
@Configuration
@ConditionalOnExpression("'${agentcore.memory.memory-id:}' != ''")
class MemoryConversationIdProvider {

    private static final Logger logger = LoggerFactory.getLogger(MemoryConversationIdProvider.class);
    private static final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Bean
    @Primary
    ConversationIdProvider memoryAwareConversationIdProvider() {
        return MemoryConversationIdProvider::resolve;
    }

    private static String resolve(AgentCoreContext context) {
        String sessionId = context.getHeader(AgentCoreHeaders.SESSION_ID);
        if (sessionId == null || sessionId.isBlank()) {
            sessionId = UUID.randomUUID().toString();
        }
        String authHeader = context.getHeader(AgentCoreHeaders.AUTHORIZATION);
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            try {
                String payload = new String(Base64.getUrlDecoder()
                    .decode(authHeader.substring(7).split("\\.")[1]));
                JsonNode claims = jsonMapper.readTree(payload);
                return claims.get("sub").asString() + ":" + sessionId;
            } catch (Exception e) {
                logger.debug("JWT parsing failed, using sessionId only", e);
            }
        }
        return sessionId;
    }
}
