package com.example.agent.limits;

import java.time.Duration;

import org.springframework.ai.chat.client.ChatClientBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ExecutionLimitsConfig {

    @Bean
    ChatClientBuilderCustomizer requestTimeoutCustomizer() {
        var advisor = new TimeoutAdvisor(Duration.ofSeconds({{timeoutSeconds}}));
        return builder -> builder.defaultAdvisors(advisor);
    }
}
