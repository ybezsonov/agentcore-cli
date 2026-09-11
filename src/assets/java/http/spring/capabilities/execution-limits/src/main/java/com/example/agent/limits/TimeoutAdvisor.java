package com.example.agent.limits;

import java.time.Duration;

import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.CallAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAdvisorChain;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.core.Ordered;
import reactor.core.publisher.Flux;

/**
 * Bounds the wall-clock duration of a single agent turn (the exported harness's {@code timeoutSeconds}
 * execution limit). Registered as the outermost advisor ({@link Ordered#HIGHEST_PRECEDENCE}) so its
 * {@link Flux#timeout(Duration)} wraps the model call <em>and</em> the entire tool-call loop; on expiry
 * the stream errors with {@code TimeoutException}, which {@code ChatService}'s {@code onErrorResume}
 * renders as the standard fallback message. The blocking (call) path is a pass-through — the agent
 * streams over SSE — kept only so the bean is a valid {@link CallAdvisor} as well.
 */
public class TimeoutAdvisor implements CallAdvisor, StreamAdvisor {

    private final Duration timeout;

    public TimeoutAdvisor(Duration timeout) {
        this.timeout = timeout;
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest request, StreamAdvisorChain chain) {
        return chain.nextStream(request).timeout(timeout);
    }

    @Override
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        return chain.nextCall(request);
    }

    @Override
    public String getName() {
        return "requestTimeoutAdvisor";
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
