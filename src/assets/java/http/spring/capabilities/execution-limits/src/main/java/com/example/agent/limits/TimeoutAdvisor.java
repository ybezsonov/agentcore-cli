package com.example.agent.limits;

import java.time.Duration;
import java.util.concurrent.TimeoutException;

import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.CallAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAdvisorChain;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.core.Ordered;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/** Bounds the total wall-clock duration of an agent turn. */
public class TimeoutAdvisor implements CallAdvisor, StreamAdvisor {

    private final Duration timeout;

    public TimeoutAdvisor(Duration timeout) {
        this.timeout = timeout;
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest request, StreamAdvisorChain chain) {
        Mono<Void> deadline = Mono.delay(timeout).then(Mono.error(timeoutException()));
        return chain.nextStream(request).takeUntilOther(deadline);
    }

    @Override
    public ChatClientResponse adviseCall(ChatClientRequest request, CallAdvisorChain chain) {
        return Mono.fromCallable(() -> chain.nextCall(request))
            .subscribeOn(Schedulers.boundedElastic())
            .timeout(timeout, Mono.error(timeoutException()))
            .block();
    }

    @Override
    public String getName() {
        return "requestTimeoutAdvisor";
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }

    private TimeoutException timeoutException() {
        return new TimeoutException("Agent turn exceeded " + timeout);
    }
}
