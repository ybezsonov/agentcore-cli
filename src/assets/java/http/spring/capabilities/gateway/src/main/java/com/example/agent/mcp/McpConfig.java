package com.example.agent.mcp;

import java.util.Set;

import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.client.transport.customizer.McpSyncHttpClientRequestCustomizer;
import org.springframework.ai.mcp.customizer.McpClientCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.http.ContentStreamProvider;
import software.amazon.awssdk.http.SdkHttpMethod;
import software.amazon.awssdk.http.SdkHttpRequest;
import software.amazon.awssdk.http.auth.aws.signer.AwsV4HttpSigner;
import software.amazon.awssdk.http.auth.spi.signer.SignedRequest;
import software.amazon.awssdk.regions.providers.DefaultAwsRegionProviderChain;

/** Adds SigV4 authentication to AWS_IAM AgentCore Gateway MCP connections. */
@Configuration
@ConditionalOnProperty("spring.ai.mcp.client.enabled")
public class McpConfig {

    private static final Set<String> GATEWAY_CONNECTIONS = Set.of({{#each gatewayProviders}}"{{name}}"{{#unless @last}}, {{/unless}}{{/each}});
    private static final Set<String> RESTRICTED_HEADERS = Set.of("content-length", "host", "expect");

    @Bean
    McpClientCustomizer<HttpClientStreamableHttpTransport.Builder> sigV4RequestCustomizer() {
        var signer = AwsV4HttpSigner.create();
        var credentialsProvider = DefaultCredentialsProvider.builder().build();
        var regionProvider = DefaultAwsRegionProviderChain.builder().build();

        // Resolves credentials and region per request from the default provider chains.
        McpSyncHttpClientRequestCustomizer requestCustomizer = (builder, method, endpoint, body, context) -> {
            var region = regionProvider.getRegion();
            var request = SdkHttpRequest.builder()
                .uri(endpoint)
                .method(SdkHttpMethod.valueOf(method))
                .putHeader("Content-Type", "application/json")
                .build();
            ContentStreamProvider payload = body != null && !body.isEmpty()
                ? ContentStreamProvider.fromUtf8String(body)
                : null;

            SignedRequest signedRequest = signer.sign(signRequest -> signRequest
                .identity(credentialsProvider.resolveIdentity().join())
                .request(request)
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
