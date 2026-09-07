# {{name}}

A Java / Spring AI agent for Amazon Bedrock AgentCore Runtime, built with the
[Spring AI AgentCore SDK](https://github.com/spring-ai-community). The `@AgentCoreInvocation`
method in `ChatService` is the entrypoint; `spring-ai-agentcore-runtime-starter` serves the
AgentCore runtime contract (`/invocations` + `/ping`, SSE streaming) on port 8080.

## Layout
- `src/main/java/com/example/agent/AgentApplication.java` — Spring Boot entrypoint.
- `src/main/java/com/example/agent/ChatService.java` — the `@AgentCoreInvocation` handler. Written
  once; capabilities (memory, gateway, …) contribute `Advisor`/`ToolCallbackProvider` beans without
  editing it.
- `src/main/resources/application.properties` — model + runtime config (env-overridable).

## Local development
```bash
MODEL_ID=us.amazon.nova-pro-v1:0 mvn spring-boot:run
# then: curl -N localhost:8080/invocations -H 'Content-Type: application/json' -d '{"prompt":"hi"}'
```
Requires AWS credentials with Bedrock access in the environment.

## Deploy
Java agents are container-only. `agentcore deploy` builds the included `Dockerfile` in CodeBuild and
creates the runtime; `agentcore invoke` (or the inspector via `agentcore dev`) calls it.
