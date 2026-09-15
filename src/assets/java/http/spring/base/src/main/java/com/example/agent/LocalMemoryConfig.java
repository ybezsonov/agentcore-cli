package com.example.agent;

import org.springframework.ai.chat.client.ChatClientBuilderCustomizer;
import org.springframework.ai.chat.client.advisor.MessageChatMemoryAdvisor;
import org.springframework.ai.chat.memory.MessageWindowChatMemory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Provides in-process conversation history when AgentCore Memory is not configured. */
@Configuration
@ConditionalOnExpression("'${agentcore.memory.memory-id:}'.isEmpty()")
public class LocalMemoryConfig {

    @Bean
    ChatClientBuilderCustomizer localMemoryCustomizer() {
        var advisor = MessageChatMemoryAdvisor.builder(MessageWindowChatMemory.builder().build()).build();
        return builder -> builder.defaultAdvisors(advisor);
    }
}
