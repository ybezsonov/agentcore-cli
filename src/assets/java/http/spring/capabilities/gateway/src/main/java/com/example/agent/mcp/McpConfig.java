package com.example.agent.mcp;

import java.util.HashSet;
import java.util.Set;

import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.client.transport.customizer.McpSyncHttpClientRequestCustomizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.mcp.customizer.McpClientCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.http.ContentStreamProvider;
import software.amazon.awssdk.http.SdkHttpMethod;
import software.amazon.awssdk.http.SdkHttpRequest;
import software.amazon.awssdk.http.auth.aws.signer.AwsV4HttpSigner;
import software.amazon.awssdk.http.auth.spi.signer.SignedRequest;
import software.amazon.awssdk.regions.providers.AwsRegionProvider;

/**
 * Signs MCP client requests to the AgentCore Gateway with AWS SigV4 (service
 * {@code bedrock-agentcore}), for AWS_IAM-authorized gateways. Active only when an MCP gateway
 * connection is configured ({@code spring.ai.mcp.client.enabled=true}, set by
 * {@code GatewayEnvironmentPostProcessor} once a gateway URL is injected at deploy).
 *
 * <p>The customizer is scoped to the <em>gateway</em> connection names only: an agent may also carry
 * remote (non-gateway) MCP server connections whose auth is static headers (see RemoteMcpConfig), and
 * every {@code McpClientCustomizer} bean is invoked for every connection — so SigV4 must not be
 * applied to a remote MCP connection that expects a bearer/API-key header instead.
 */
@Configuration
@ConditionalOnProperty(name = "spring.ai.mcp.client.enabled", havingValue = "true")
public class McpConfig {

    private static final Logger log = LoggerFactory.getLogger(McpConfig.class);
    private static final Set<String> RESTRICTED_HEADERS = Set.of("content-length", "host", "expect");

    // The gateway connection names this SigV4 customizer signs for (name-contract with the connection
    // URLs GatewayEnvironmentPostProcessor registers). Other connections (remote MCP) are left alone.
    private static final Set<String> GATEWAY_CONNECTIONS = new HashSet<>();
    static {
{{#each gatewayProviders}}
        GATEWAY_CONNECTIONS.add("{{name}}");
{{/each}}
    }

    @Bean
    McpClientCustomizer<HttpClientStreamableHttpTransport.Builder> sigV4RequestCustomizer(
            AwsCredentialsProvider credentialsProvider, AwsRegionProvider regionProvider) {
        var signer = AwsV4HttpSigner.create();
        // Share the credential + region resolution Spring AI uses for the chat model (both provider
        // beans come from the Bedrock Converse auto-configuration); credentials are resolved
        // per-request below so rotation is honored.
        var region = regionProvider.getRegion();
        log.info("SigV4 MCP request customizer: region={}, service=bedrock-agentcore", region);

        McpSyncHttpClientRequestCustomizer requestCustomizer = (builder, method, endpoint, body, context) -> {
            var httpRequest = SdkHttpRequest.builder()
                .uri(endpoint)
                .method(SdkHttpMethod.valueOf(method))
                .putHeader("Content-Type", "application/json")
                .build();

            ContentStreamProvider payload = (body != null && !body.isEmpty())
                ? ContentStreamProvider.fromUtf8String(body)
                : null;

            SignedRequest signedRequest = signer.sign(r -> r
                .identity(credentialsProvider.resolveIdentity().join())
                .request(httpRequest)
                .payload(payload)
                .putProperty(AwsV4HttpSigner.SERVICE_SIGNING_NAME, "bedrock-agentcore")
                .putProperty(AwsV4HttpSigner.REGION_NAME, region.id()));

            signedRequest.request().headers().forEach((name, values) -> {
                if (!RESTRICTED_HEADERS.contains(name.toLowerCase())) {
                    values.forEach(value -> builder.setHeader(name, value));
                }
            });
        };

        return (name, transportBuilder) -> {
            if (GATEWAY_CONNECTIONS.contains(name)) {
                transportBuilder.httpRequestCustomizer(requestCustomizer);
            }
        };
    }
}
