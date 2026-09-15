package com.example.agent.memory;

import org.springaicommunity.agentcore.memory.longterm.AgentCoreMemory;
import org.springframework.ai.chat.client.ChatClientBuilderCustomizer;
import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty("agentcore.memory.memory-id")
public class MemoryConfig {

    @Bean
    ChatClientBuilderCustomizer agentCoreMemoryCustomizer(AgentCoreMemory memory) {
        return builder -> builder.defaultAdvisors(memory.advisors.toArray(new Advisor[0]));
    }
}
