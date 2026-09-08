package com.example.agent.memory;

import org.springaicommunity.agentcore.memory.longterm.AgentCoreMemory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.example.agent.AdvisorBundle;

/**
 * Exposes the AgentCore memory advisors (short-term conversation + long-term) to {@code ChatService}.
 *
 * <p>The memory advisors are reachable only as a group via the {@link AgentCoreMemory} bean's
 * {@code advisors} field — the short-term {@code MessageChatMemoryAdvisor} is built inside that bean
 * and the long-term advisors are produced as a list, so none of them are individual {@code Advisor}
 * context beans. They are therefore contributed as an {@link AdvisorBundle}, which {@code ChatService}
 * collects alongside individual advisors.
 *
 * <p>Gated on the {@code agentcore.memory.memory-id} property (the same gate the memory
 * auto-configuration uses) rather than {@code @ConditionalOnBean(AgentCoreMemory.class)}:
 * {@code @ConditionalOnBean} is unreliable in user configuration because {@link AgentCoreMemory} is
 * contributed by an auto-configuration processed <em>after</em> user configuration, so the condition
 * would evaluate false and the bundle would silently never be created. When no {@code MEMORY_<NAME>_ID}
 * is injected (local runs before deploy) the property is empty, this configuration is skipped, and the
 * memory auto-configuration self-gates off — the agent runs as a plain chat agent.
 */
@Configuration
@ConditionalOnExpression("'${agentcore.memory.memory-id:}' != ''")
class MemoryConfig {

    @Bean
    AdvisorBundle memoryAdvisors(AgentCoreMemory agentCoreMemory) {
        return new AdvisorBundle(agentCoreMemory.advisors);
    }
}
