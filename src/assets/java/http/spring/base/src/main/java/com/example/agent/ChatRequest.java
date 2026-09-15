package com.example.agent;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Request body for the AgentCore {@code /invocations} endpoint. Fields other than {@code prompt} are ignored. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ChatRequest(String prompt) {
}
