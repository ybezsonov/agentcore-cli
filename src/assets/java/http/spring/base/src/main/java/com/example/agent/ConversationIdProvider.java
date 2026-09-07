package com.example.agent;

import org.springaicommunity.agentcore.context.AgentCoreContext;

/**
 * Resolves the conversation id passed to advisors for each invocation. The core default returns the
 * runtime session id; the memory capability overrides this (as {@code @Primary}) to produce a
 * {@code userId:sessionId} composite for long-term memory keying.
 */
public interface ConversationIdProvider {
    String resolve(AgentCoreContext context);
}
