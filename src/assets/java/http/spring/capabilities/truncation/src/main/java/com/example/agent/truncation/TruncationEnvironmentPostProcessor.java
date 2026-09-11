package com.example.agent.truncation;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Enables the AgentCore Session API read-window (the exported harness's truncation limit) — but ONLY
 * when the memory id env var ({@code MEMORY_<NAME>_ID}) is present, mirroring
 * {@code MemoryEnvironmentPostProcessor}. The Session API is memory-backed, so with no memory id
 * (local runs before deploy, or an agent without memory) the session stays off and the app boots
 * inert as a plain chat agent; at deploy the memory id is injected and the session activates, bounding
 * the recent-events window via {@code agentcore.memory.session.total-events-limit}. For
 * {@code summarization} truncation the older context surfaces through the memory's long-term
 * SUMMARIZATION strategy (auto-discovered by the memory capability), so no in-window summarizer is
 * needed here.
 *
 * <p>Requires {@code spring-ai-agentcore} 2.2.0+ (the Session API). Runs as an
 * {@code EnvironmentPostProcessor} so the property is set before the session auto-configuration's
 * {@code @ConditionalOnProperty} gate evaluates.
 */
public class TruncationEnvironmentPostProcessor implements EnvironmentPostProcessor {

    private static final String MEMORY_ID_ENV = "{{memoryProviders.[0].envVarName}}";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String memoryId = System.getenv(MEMORY_ID_ENV);
        if (memoryId == null || memoryId.isBlank()) {
            return; // no memory at runtime → Session API stays off → truncation is a no-op (inert boot)
        }
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("agentcore.memory.session.enabled", "true");
{{#if sessionTotalEventsLimit}}
        props.put("agentcore.memory.session.total-events-limit", "{{sessionTotalEventsLimit}}");
{{/if}}
        environment.getPropertySources().addFirst(new MapPropertySource("agentcoreTruncation", props));
    }
}
