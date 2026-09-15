package com.example.agent;

import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.ai.tool.resolution.ToolCallbackResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Answers a tool call whose name matches none of the request's tools with a tool error, so the model can
 * retry with a listed name. Requires {@code spring.ai.tools.resolution.fallback.enabled=true}. This resolver
 * replaces Spring AI's default one, so no tool outside the request's tool list can be resolved by name.
 * Replace with {@code spring.ai.tools.resolution.on-unresolved=return-error-response} once the template's
 * Spring AI version supports it.
 */
@Configuration
public class UnknownToolConfig {

    @Bean
    ToolCallbackResolver toolCallbackResolver() {
        return unknownToolResolver();
    }

    static ToolCallbackResolver unknownToolResolver() {
        return UnknownToolCallback::new;
    }

    /** Tool result returned for a tool name that is not offered in the request. */
    static final class UnknownToolCallback implements ToolCallback {

        private final ToolDefinition definition;

        UnknownToolCallback(String name) {
            this.definition = ToolDefinition.builder()
                .name(name)
                .description("Unknown tool")
                .inputSchema("{\"type\":\"object\"}")
                .build();
        }

        @Override
        public ToolDefinition getToolDefinition() {
            return definition;
        }

        @Override
        public String call(String toolInput) {
            return "Error: no tool is named \"" + definition.name()
                + "\". Call one of the tools listed in this request, using its exact name.";
        }
    }
}
