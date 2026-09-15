package com.example.agent;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/** Bridges non-blank AgentCore runtime environment values to Spring configuration. */
public class AgentCoreEnvironmentPostProcessor implements EnvironmentPostProcessor {

    private static final Set<String> MEMORY_ENV_VARS = Set.of({{#each memoryProviders}}"{{envVarName}}"{{#unless @last}}, {{/unless}}{{/each}});
    private static final Set<String> GATEWAY_ENV_VARS = Set.of({{#each gatewayProviders}}"{{envVarName}}"{{#unless @last}}, {{/unless}}{{/each}});
    private static final Map<String, String> ENV_TO_PROPERTY = Map.ofEntries(
{{#each memoryProviders}}
        Map.entry("{{envVarName}}", "agentcore.memory.memory-id"){{#unless @last}},{{else}}{{#if ../gatewayProviders.length}},{{/if}}{{/unless}}
{{/each}}
{{#each gatewayProviders}}
        Map.entry("{{envVarName}}", "spring.ai.mcp.client.streamable-http.connections.{{name}}.url"){{#unless @last}},{{/unless}}
{{/each}}
    );

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> properties = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : ENV_TO_PROPERTY.entrySet()) {
            String value = System.getenv(entry.getKey());
            if (value != null && !value.isBlank()) {
                properties.put(entry.getValue(), value);
                if (MEMORY_ENV_VARS.contains(entry.getKey())) {
                    properties.put("agentcore.memory.long-term.auto-discovery", true);
                }
                if (GATEWAY_ENV_VARS.contains(entry.getKey())) {
                    properties.put("spring.ai.mcp.client.enabled", true);
                }
            }
        }

        if (!properties.isEmpty()) {
            environment.getPropertySources().addAfter(
                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                new MapPropertySource("agentcoreEnvironment", properties)
            );
        }
    }
}
