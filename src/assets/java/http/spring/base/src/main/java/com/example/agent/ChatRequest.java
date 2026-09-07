package com.example.agent;

/**
 * Request body for the agent's /invocations endpoint. The AgentCore inspector and
 * `agentcore invoke` send {"prompt": "..."}.
 */
public record ChatRequest(String prompt) {
}
