package com.example.agent.limits;

{{#if timeoutSeconds}}
import java.time.Duration;

import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.context.annotation.Bean;
{{/if}}
import org.springframework.context.annotation.Configuration;

/**
 * Registers execution-limit advisors from the exported harness's limits. Today only the request
 * TIMEOUT is wired — a {@link TimeoutAdvisor} that bounds the turn's wall-clock time via a
 * {@code Flux.timeout}. The token and iteration budgets ({@code maxTokens} / {@code maxIterations})
 * need Spring AI tool-call-loop introspection (the loop is internal to the ChatModel), so they are a
 * tracked follow-up — see review doc 7 (Phase B). The advisor drops into the base ChatService's
 * {@code List<Advisor>} with no base change.
 */
@Configuration
class ExecutionLimitsConfig {
{{#if timeoutSeconds}}

    @Bean
    Advisor requestTimeoutAdvisor() {
        return new TimeoutAdvisor(Duration.ofSeconds({{timeoutSeconds}}));
    }
{{/if}}
}
