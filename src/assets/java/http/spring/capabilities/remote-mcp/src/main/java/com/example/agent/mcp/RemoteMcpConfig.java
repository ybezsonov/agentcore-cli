package com.example.agent.mcp;

import java.util.LinkedHashMap;
import java.util.Map;

import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.client.transport.customizer.McpSyncHttpClientRequestCustomizer;
import org.springframework.ai.mcp.customizer.McpClientCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Adds static header credentials (e.g. API keys) to requests for remote (non-gateway) MCP servers
 * that declare header auth. The header VALUES come from AgentCore Identity credentials injected at
 * deploy as env vars (AGENTCORE_CREDENTIAL_&lt;NAME&gt;); they are read per request so rotation is
 * honored and so a missing key locally simply yields no header (the call fails with 401 at first tool
 * use, not at boot — the app still boots inert).
 *
 * <p>Scoped to the remote-MCP connection names only. Every {@link McpClientCustomizer} bean is invoked
 * for every connection, so this must NOT touch gateway connections (which authenticate with SigV4 —
 * see McpConfig). The two customizers key on disjoint connection-name sets.
 */
@Configuration
@ConditionalOnProperty(name = "spring.ai.mcp.client.enabled", havingValue = "true")
public class RemoteMcpConfig {

    // Remote MCP connection name -> (HTTP header name -> credential env var name). Populated only for
    // servers that declared header credentials; URL-only remote servers need no customizer.
    private static final Map<String, Map<String, String>> REMOTE_HEADER_ENV = new LinkedHashMap<>();
    static {
{{#each remoteMcpTools}}
{{#if headerCredentials}}
        {
            Map<String, String> headers = new LinkedHashMap<>();
{{#each headerCredentials}}
            headers.put("{{headerKey}}", "{{envVarName}}");
{{/each}}
            REMOTE_HEADER_ENV.put("{{name}}", headers);
        }
{{/if}}
{{/each}}
    }

    @Bean
    McpClientCustomizer<HttpClientStreamableHttpTransport.Builder> remoteMcpHeaderCustomizer() {
        return (name, transportBuilder) -> {
            Map<String, String> headerEnv = REMOTE_HEADER_ENV.get(name);
            if (headerEnv == null || headerEnv.isEmpty()) {
                return; // not a header-auth remote MCP connection (gateway or URL-only) — leave it alone
            }
            McpSyncHttpClientRequestCustomizer requestCustomizer =
                (builder, method, endpoint, body, context) ->
                    headerEnv.forEach((headerName, envVar) -> {
                        String value = System.getenv(envVar);
                        if (value != null && !value.isBlank()) {
                            builder.setHeader(headerName, value);
                        }
                    });
            transportBuilder.httpRequestCustomizer(requestCustomizer);
        };
    }
}
