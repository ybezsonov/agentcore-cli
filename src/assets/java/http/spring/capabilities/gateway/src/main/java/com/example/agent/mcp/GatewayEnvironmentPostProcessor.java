package com.example.agent.mcp;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Bridges AgentCore Gateway URL env vars ({@code AGENTCORE_GATEWAY_<NAME>_URL}, injected at deploy) to
 * the Spring AI MCP client connection properties. It enables the MCP client and registers a
 * streamable-HTTP connection per gateway <em>only</em> when that gateway's URL env var is present and
 * non-blank.
 *
 * <p>Why a bridge rather than {@code ...connections.<name>.url=${AGENTCORE_GATEWAY_<NAME>_URL:}} in
 * application.properties: {@code McpClientAutoConfiguration} is
 * {@code @ConditionalOnProperty(name="spring.ai.mcp.client.enabled", havingValue="true",
 * matchIfMissing=true)} — enabled by default — so the properties default it to {@code false} and this
 * post-processor flips it to {@code true} only when at least one gateway URL is present. With no
 * gateway URL (local runs before deploy) the client stays disabled and the agent boots inert as a
 * plain chat agent, matching the Python template (its MCP client returns {@code None} when the URL is
 * unset) and the memory capability's bridge. It also sidesteps the Spring/Handlebars brace clash a
 * templated property placeholder would introduce.
 */
public class GatewayEnvironmentPostProcessor implements EnvironmentPostProcessor {

    // MCP connection name -> URL env var (name-contract AGENTCORE_GATEWAY_<NAME>_URL).
    private static final Map<String, String> GATEWAY_URL_ENV = new LinkedHashMap<>();
    static {
{{#each gatewayProviders}}
        GATEWAY_URL_ENV.put("{{name}}", "{{envVarName}}");
{{/each}}
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Map<String, Object> props = new LinkedHashMap<>();
        GATEWAY_URL_ENV.forEach((connection, envVar) -> {
            String url = System.getenv(envVar);
            if (url != null && !url.isBlank()) {
                props.put("spring.ai.mcp.client.streamable-http.connections." + connection + ".url", url);
            }
        });
        if (!props.isEmpty()) {
            props.put("spring.ai.mcp.client.enabled", "true");
            environment.getPropertySources().addFirst(new MapPropertySource("agentcoreGateway", props));
        }
    }
}
