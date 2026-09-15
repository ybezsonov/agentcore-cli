# Agent Frameworks

AgentCore CLI supports multiple agent frameworks for template-based agent creation, plus a BYO (Bring Your Own) option
for existing code.

## Supported Languages

| Language   | Supported Frameworks | Runtime      | Notes                                                                              |
| ---------- | -------------------- | ------------ | ---------------------------------------------------------------------------------- |
| Python     | All frameworks       | Python 3.12+ | Default language. Uses `uv` for dependency management.                             |
| TypeScript | Strands, Vercel AI   | Node 22      | Uses `npm` + `tsx` for the dev loop. Other frameworks are not yet available in TS. |
| Java       | SpringAI             | Java 21      | Uses Maven for the dev loop. HTTP, Bedrock, and Container only.                    |

Pass `--language TypeScript` to `agentcore create` or `agentcore add agent` to scaffold a TypeScript project. The
framework is restricted to `Strands` or `VercelAI`; other values are rejected. See
[Local Development](local-development.md#typescript-agents) for the TS dev loop.

Pass `--language Java --framework SpringAI` to scaffold a Java project. Java agents use HTTP, Bedrock, and Container
builds only. See [Spring AI](#spring-ai-java) and [Local Development](local-development.md#java-agents).

## Available Frameworks

| Framework               | Supported Model Providers          |
| ----------------------- | ---------------------------------- |
| **Strands Agents**      | Bedrock, Anthropic, OpenAI, Gemini |
| **LangChain_LangGraph** | Bedrock, Anthropic, OpenAI, Gemini |
| **GoogleADK**           | Gemini only                        |
| **OpenAIAgents**        | OpenAI only                        |
| **VercelAI**            | Bedrock, Anthropic, OpenAI, Gemini |
| **SpringAI**            | Bedrock only                       |

## Runtime Input Validation

Validate agent invocation payloads before passing them to a framework. Template entrypoints validate plain prompts as
strings; preserve that validation when extending a generated application, and pass only prompt text to the agent.

## Framework Selection Guide

### Strands Agents

AWS's native agent framework designed for Amazon Bedrock.

**Best for:**

- Projects primarily using Amazon Bedrock models
- Integration with AWS services
- Production deployments on AWS infrastructure

**Model providers:** Bedrock, Anthropic, OpenAI, Gemini

**Languages:** Python, TypeScript

```bash
agentcore create --framework Strands --model-provider Bedrock

# TypeScript variant
agentcore create --framework Strands --model-provider Bedrock --language TypeScript
```

### LangChain / LangGraph

Popular open-source framework with extensive ecosystem.

**Best for:**

- Complex multi-step agent workflows
- Projects requiring LangChain's extensive tool ecosystem
- Teams already familiar with LangChain

**Model providers:** Bedrock, Anthropic, OpenAI, Gemini

```bash
agentcore create --framework LangChain_LangGraph --model-provider Anthropic
```

### GoogleADK

Google's Agent Development Kit.

**Best for:**

- Projects using Google's Gemini models
- Integration with Google Cloud services

**Model providers:** Gemini only

```bash
agentcore create --framework GoogleADK --model-provider Gemini
```

### OpenAIAgents

OpenAI's native agent framework.

**Best for:**

- Projects using OpenAI models exclusively
- Simple agent workflows with OpenAI's function calling

**Model providers:** OpenAI only

```bash
agentcore create --framework OpenAIAgents --model-provider OpenAI --api-key sk-...
```

### Vercel AI SDK

Vercel's AI SDK for building AI-powered applications.

**Best for:**

- Full-stack AI applications with streaming support
- Projects using Vercel's ecosystem
- TypeScript-first agent development

**Model providers:** Bedrock, Anthropic, OpenAI, Gemini

**Languages:** Python, TypeScript

```bash
agentcore create --framework VercelAI --model-provider Bedrock

# TypeScript variant
agentcore create --framework VercelAI --model-provider Bedrock --language TypeScript
```

### Spring AI (Java)

Spring AI agents use Java 21 and Maven, run over HTTP, and deploy as Container builds with Bedrock Converse.

```bash
agentcore create \
  --name MyJavaAgent \
  --language Java \
  --framework SpringAI \
  --model-provider Bedrock \
  --protocol HTTP \
  --build Container
```

#### Supported matrix

| Area                            | Java / Spring AI support                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / framework / protocol | Java / SpringAI / HTTP                                                                                                                                         |
| Build                           | Container only (Corretto 21 image)                                                                                                                             |
| Model provider                  | Bedrock only (Converse) — region from `AWS_REGION`                                                                                                             |
| Memory                          | AgentCore Memory short + long-term via the SDK's auto-discovery; in-process `MessageWindowChatMemory` when no memory is configured                             |
| Gateways                        | `AWS_IAM` authorizer only (SigV4 via `McpClientCustomizer`)                                                                                                    |
| Remote MCP                      | URL-only (no header auth)                                                                                                                                      |
| Skills                          | path + public-git, staged under `src/main/resources/skills/`                                                                                                   |
| Execution limits                | `timeoutSeconds` only                                                                                                                                          |
| Memory retrieval window         | When a harness has memory and a truncation limit, render `agentcore.memory.short-term.total-events-limit=<limit>`; no truncation EPP or Session API dependency |
| Builtins                        | Via harness export only (code-interpreter and browser default connections; custom identifiers via env)                                                         |
| Dev loop                        | `agentcore dev` via `mvn spring-boot:run`, with `AWS_REGION` passed through                                                                                    |
| Export harness                  | Same matrix; unsupported source features are rejected or surfaced in the coverage notes below                                                                  |

Generated Java runtimes retain `main.py` as Container validation metadata. The container image `CMD` starts the jar; the
placeholder is not executed.

#### Rejected combinations

Unsupported create/add inputs are rejected before an agent directory is written. Unsupported export inputs are rejected
or reported as coverage notes; nothing is silently dropped.

| Combination                                   | Exact CLI message                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-Bedrock model provider                    | `${provider} model provider is not yet supported for Java agents. Use --model-provider Bedrock.`                                                               |
| Authenticated remote MCP headers              | `Authenticated remote MCP headers are not yet supported for Java agents. Remove the headers or export the harness as Python.`                                  |
| Gateway authorizer `CUSTOM_JWT` or `NONE`     | `Gateway "${name}" uses ${authorizerType}; Java agents support only AWS_IAM gateways.`                                                                         |
| Session-storage, EFS, or S3 filesystem mounts | `Filesystem mounts are not supported for Java agents. Remove --session-storage-mount-path, --efs-access-point-arn, and --s3-access-point-arn.`                 |
| Config bundle                                 | `--with-config-bundle is not supported for Java agents.`                                                                                                       |
| CodeZip                                       | `--build CodeZip is not supported for Java agents. Use --build Container or omit --build.`                                                                     |
| Protocol other than HTTP                      | `${protocol} protocol is not yet supported for Java agents. Use --protocol HTTP.`                                                                              |
| Framework other than SpringAI                 | `Framework ${framework} is not yet available for Java agents. Use --framework SpringAI.`                                                                       |
| Harness with `containerUri` or `dockerfile`   | `Java export does not support a custom containerUri or dockerfile; the generated agent ships its own Dockerfile. Remove them or export the harness as Python.` |
| Payment option targeting Java                 | `Payments are not supported for Java agents.`                                                                                                                  |
| Payments configured for another agent         | `This project contains payment configuration for another agent; payments are not available to the new Java agent.`                                             |

#### Export coverage notes

| Feature                                         | Exact coverage note                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Truncation without AgentCore Memory             | `Java truncation requires AgentCore Memory. Add memory or remove truncation; the generated Java agent does not include truncation.`             |
| Full summarization semantics                    | `Java/SpringAI maps the truncation limit to the AgentCore Memory retrieval window; an in-process summarization component is not yet supported.` |
| `maxTokens` or `maxIterations`                  | `Java/SpringAI export does not yet enforce maxTokens or maxIterations; these values were omitted. timeoutSeconds is supported.`                 |
| Inline function tools                           | `Java/SpringAI export does not yet support inline function tools; <count> tool(s) were omitted. Export as Python if they are required.`         |
| Builtin `shell` or `file_operations`            | `Java/SpringAI export does not yet support builtin shell or file_operations tools; they were omitted.`                                          |
| S3 or private-git skills                        | `Java/SpringAI export supports path and public-git skills; s3 and private-git skills are not yet supported and were omitted.`                   |
| Harness `actorId`                               | `Java export does not yet apply the harness actorId; the agent derives the actor from the runtime user-id header (default default-user).`       |
| `messages` / `tool_results` invocation payloads | `The Java agent accepts {"prompt": …} only; messages/tool_results payload shapes are not yet supported.`                                        |

#### Unchanged or not applicable

| Area                     | Treatment                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment variables    | Existing agent/runtime env-var authoring remains language-agnostic and unchanged. Java-specific memory and gateway env vars are bridged by one environment post-processor. |
| Lifecycle configuration  | Existing idle-timeout and max-lifetime resource configuration remains unchanged.                                                                                           |
| VPC / capacity providers | Existing resource-level networking and capacity-provider behavior remains unchanged. Java remains Container-only.                                                          |
| Request headers          | Existing runtime request-header allowlist behavior remains unchanged. This does not add remote-MCP credential headers.                                                     |
| Runtime authorizer       | Existing runtime authorizer behavior remains unchanged and is distinct from gateway authorizer support.                                                                    |
| Evaluations              | Existing language-agnostic evaluation resources remain unchanged.                                                                                                          |
| Observability wiring     | Existing resource-level behavior remains unchanged. Java does not wire OTel export and does not fetch an OTel agent.                                                       |
| BYO Java                 | `add agent --type byo --language Java` emits no `runtimeVersion`; otherwise unchanged.                                                                                     |
| Payments                 | Payment options targeting Java agents are rejected; payments attached to other agents only produce the warning above.                                                      |
| Multi-agent              | Java caller-side multi-agent orchestration is not generated.                                                                                                               |

## Import from Bedrock Agents

If you have an existing Bedrock Agent, you can import its configuration and translate it into runnable Strands or
LangChain/LangGraph code. The imported agent preserves your Bedrock Agent's action groups, knowledge bases, multi-agent
collaboration, guardrails, prompts, and memory configuration.

```bash
# Interactive (select "Import from Bedrock Agents" in the wizard)
agentcore add agent

# Non-interactive
agentcore add agent \
  --name MyAgent \
  --type import \
  --agent-id AGENT123 \
  --agent-alias-id ALIAS456 \
  --region us-east-1 \
  --framework Strands \
  --memory none
```

### What gets imported

The import process fetches your Bedrock Agent's full configuration and translates it into framework-specific Python code
that runs on AgentCore:

- **Action groups** (function-schema and built-in) become `@tool` decorated functions
- **Knowledge bases** become retrieval tool integrations
- **Multi-agent collaboration** produces separate collaborator files with recursive translation
- **Code interpreter** wires to AgentCore's `code_interpreter_client`
- **Guardrails** are configured in the model initialization
- **Prompt overrides** are preserved as template variables
- **Memory** integrates with AgentCore's memory service when enabled

### Import options

| Flag                    | Description                               |
| ----------------------- | ----------------------------------------- |
| `--type import`         | Use import mode (required)                |
| `--agent-id <id>`       | Bedrock Agent ID                          |
| `--agent-alias-id <id>` | Bedrock Agent Alias ID                    |
| `--region <region>`     | AWS region where the Bedrock Agent exists |
| `--framework <fw>`      | `Strands` or `LangChain_LangGraph`        |
| `--memory <opt>`        | `none`, `shortTerm`, `longAndShortTerm`   |

## Bring Your Own (BYO) Agent

For existing agent code or frameworks not listed above, use the BYO option:

```bash
agentcore add agent \
  --name MyAgent \
  --type byo \
  --code-location ./my-agent \
  --entrypoint main.py \
  --language Python
```

### BYO Requirements

1. **Entrypoint**: Your code must expose an HTTP endpoint that accepts agent invocation requests
2. **Code location**: Directory containing your agent code
3. **Language**: Python, TypeScript, or Java. BYO Java emits no `runtimeVersion`; otherwise BYO behavior is unchanged.

### BYO Options

| Flag                     | Description                                |
| ------------------------ | ------------------------------------------ |
| `--type byo`             | Use BYO mode (required)                    |
| `--code-location <path>` | Directory containing your agent code       |
| `--entrypoint <file>`    | Entry file (e.g., `main.py` or `index.ts`) |
| `--language <lang>`      | `Python`, `TypeScript`, or `Java`          |

## Framework Comparison

| Feature                | Strands | LangChain | GoogleADK | OpenAIAgents | VercelAI |
| ---------------------- | ------- | --------- | --------- | ------------ | -------- |
| Multi-provider support | Yes     | Yes       | No        | No           | Yes      |
| AWS Bedrock native     | Yes     | No        | No        | No           | No       |
| Tool ecosystem         | Growing | Extensive | Moderate  | Moderate     | Moderate |
| Memory integration     | Native  | Via libs  | Via libs  | Via libs     | Via libs |

## Protocol Compatibility

Not all frameworks support all protocol modes. MCP protocol is a standalone tool server with no framework.

| Protocol | Supported Frameworks                                                      |
| -------- | ------------------------------------------------------------------------- |
| **HTTP** | Strands, LangChain_LangGraph, GoogleADK, OpenAIAgents, VercelAI, SpringAI |
| **MCP**  | None (standalone tool server)                                             |
| **A2A**  | Strands, GoogleADK, LangChain_LangGraph                                   |
