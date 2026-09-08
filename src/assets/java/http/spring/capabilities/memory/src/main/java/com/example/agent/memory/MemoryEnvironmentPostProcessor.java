package com.example.agent.memory;

import java.util.Map;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Bridges the AgentCore name-contract environment variable {@code MEMORY_<NAME>_ID} (injected onto
 * the runtime at deploy) to the Spring property {@code agentcore.memory.memory-id}.
 *
 * <p>The bridge is deliberate: the {@code spring-ai-agentcore-memory} auto-configuration gates on
 * {@code @ConditionalOnProperty(name = "agentcore.memory.memory-id")} <em>without</em>
 * {@code matchIfMissing}, and Spring treats a <em>present-but-empty</em> property as a match — so
 * declaring {@code agentcore.memory.memory-id=${...:}} in {@code application.properties} would
 * activate the auto-configuration with an empty id, which fails fast at boot
 * ({@code MemoryId cannot be null or empty}). Only a genuinely <em>absent</em> property lets the
 * auto-configuration self-gate off.
 *
 * <p>So instead of a properties placeholder, this post-processor sets the property here <em>only</em>
 * when the env var is present and non-blank. With no env var (local runs before the first deploy)
 * the property stays absent, memory stays inert, and the app boots as a plain chat agent — matching
 * the Python template, whose memory session manager is a no-op when {@code MEMORY_<NAME>_ID} is
 * unset. At deploy the runtime injects the env var, the property materializes, and short- and
 * long-term memory activate. No {@code @aws/agentcore-cdk} change is required.
 */
public class MemoryEnvironmentPostProcessor implements EnvironmentPostProcessor {

    private static final String ENV_VAR = "{{memoryProviders.[0].envVarName}}";
    private static final String PROPERTY = "agentcore.memory.memory-id";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String memoryId = System.getenv(ENV_VAR);
        if (memoryId != null && !memoryId.isBlank()) {
            environment.getPropertySources()
                .addFirst(new MapPropertySource("agentcoreMemory", Map.of(PROPERTY, memoryId)));
        }
    }
}
