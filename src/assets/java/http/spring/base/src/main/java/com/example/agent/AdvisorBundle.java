package com.example.agent;

import java.util.List;

import org.springframework.ai.chat.client.advisor.api.Advisor;

/**
 * A bundle of advisors contributed by a capability that produces several advisors as a unit
 * (e.g. the memory capability, whose short-term and long-term advisors are only reachable as a
 * group via the {@code AgentCoreMemory} bean).
 *
 * <p>{@link ChatService} collects individual {@link Advisor} beans <em>and</em> all
 * {@code AdvisorBundle} beans, so a capability may contribute either an individual advisor or a
 * bundle without {@code ChatService} referencing any capability-specific type. When a capability is
 * absent its bundle bean is simply not present and the collection is empty.
 */
public record AdvisorBundle(List<Advisor> advisors) {
}
