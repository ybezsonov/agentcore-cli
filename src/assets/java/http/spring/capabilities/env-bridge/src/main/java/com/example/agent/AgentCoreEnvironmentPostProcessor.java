package com.example.agent;

import java.util.LinkedHashMap;
import java.util.Map;
{{#unless (eq memoryProviders.length 1)}}
import java.util.Set;
{{else}}
{{#unless (eq gatewayProviders.length 1)}}
import java.util.Set;
{{/unless}}
{{/unless}}

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

/** Bridges non-blank AgentCore runtime environment values to Spring configuration. */
public class AgentCoreEnvironmentPostProcessor implements EnvironmentPostProcessor {
{{#if (eq memoryProviders.length 1)}}
{{#if (eq gatewayProviders.length 1)}}

    private static final String MEMORY_ENV_VAR = "{{memoryProviders.[0].envVarName}}";
    private static final String GATEWAY_ENV_VAR = "{{gatewayProviders.[0].envVarName}}";
    private static final Map<String, String> ENV_TO_PROPERTY = Map.of(
        MEMORY_ENV_VAR, "agentcore.memory.memory-id",
        GATEWAY_ENV_VAR, "spring.ai.mcp.client.streamable-http.connections.{{gatewayProviders.[0].name}}.url"
    );
{{else}}

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
{{/if}}
{{else}}

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
{{/if}}

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> properties = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : ENV_TO_PROPERTY.entrySet()) {
            String value = System.getenv(entry.getKey());
            if (value != null && !value.isBlank()) {
                properties.put(entry.getValue(), value);
{{#if (eq memoryProviders.length 1)}}
{{#if (eq gatewayProviders.length 1)}}
                if (MEMORY_ENV_VAR.equals(entry.getKey())) {
                    properties.put("agentcore.memory.long-term.auto-discovery", true);
                }
                if (GATEWAY_ENV_VAR.equals(entry.getKey())) {
                    properties.put("spring.ai.mcp.client.enabled", true);
                }
{{else}}
                if (MEMORY_ENV_VARS.contains(entry.getKey())) {
                    properties.put("agentcore.memory.long-term.auto-discovery", true);
                }
                if (GATEWAY_ENV_VARS.contains(entry.getKey())) {
                    properties.put("spring.ai.mcp.client.enabled", true);
                }
{{/if}}
{{else}}
                if (MEMORY_ENV_VARS.contains(entry.getKey())) {
                    properties.put("agentcore.memory.long-term.auto-discovery", true);
                }
                if (GATEWAY_ENV_VARS.contains(entry.getKey())) {
                    properties.put("spring.ai.mcp.client.enabled", true);
                }
{{/if}}
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
