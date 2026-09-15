import type { HarnessSpec } from '../../../../../schema/schemas/primitives/harness';
import { AWS_SKILLS_NOTE_CATEGORY } from '../../constants';
import { mapHarnessToExportConfig } from '../../harness-mapper';
import type { ResolvedHarnessContext } from '../../types';
import {
  JAVA_ACTOR_ID_NOTE_CATEGORY,
  JAVA_BUILTIN_TOOLS_NOTE_CATEGORY,
  JAVA_EXECUTION_LIMITS_NOTE_CATEGORY,
  JAVA_EXTERNAL_MEMORY_NOTE_CATEGORY,
  JAVA_INLINE_TOOLS_NOTE_CATEGORY,
  JAVA_PAYLOAD_NOTE_CATEGORY,
  JAVA_SKILLS_NOTE_CATEGORY,
  JAVA_TRUNCATION_NOTE_CATEGORY,
} from '../constants';
import { describe, expect, it } from 'vitest';

function baseSpec(overrides: Partial<HarnessSpec> = {}): HarnessSpec {
  return {
    name: 'TestHarness',
    model: { provider: 'bedrock', modelId: 'global.anthropic.claude-sonnet-4-6' },
    tools: [],
    skills: [],
    ...overrides,
  } as HarnessSpec;
}

function baseContext(
  specOverrides: Partial<HarnessSpec> = {},
  contextOverrides: Partial<ResolvedHarnessContext> = {}
): ResolvedHarnessContext {
  return {
    harnessName: 'TestHarness',
    targetAgentName: 'TestAgent',
    spec: baseSpec(specOverrides),
    systemPrompt: 'You are helpful.',
    projectSpec: { name: 'myproject', runtimes: [], memories: [], credentials: [], harnesses: [] } as any,
    deployedResources: null,
    configBaseDir: '/project/agentcore',
    projectRoot: '/project',
    exportNotes: [],
    region: 'us-east-1',
    localEnvVars: {},
    generatedPolicyFiles: {},
    additionalPolicies: [],
    ...contextOverrides,
  };
}

function noteCategories(context: ResolvedHarnessContext): string[] {
  return context.exportNotes.map(n => n.category);
}

// ============================================================================
// Java / SpringAI export
// ============================================================================

describe('Java / SpringAI export', () => {
  const JAVA = { targetLanguage: 'Java', sdkFramework: 'SpringAI' } as const;
  // A token-vault API-key ARN → the identity resolver derives the credential name from its last segment.
  const OPENAI_KEY_ARN =
    'arn:aws:bedrock-agentcore:us-east-1:123456789012:token-vault/default/apikeycredentialprovider/mykey';
  const PROJECT_WITH_MEMORY = {
    projectSpec: {
      name: 'p',
      runtimes: [],
      memories: [{ name: 'mem', strategies: [] }],
      credentials: [],
      harnesses: [],
    } as any,
  };
  const memCtx = (specOverrides: Partial<HarnessSpec>) =>
    baseContext(
      { allowedTools: ['t'], memory: { mode: 'existing', name: 'mem' }, ...specOverrides },
      PROJECT_WITH_MEMORY
    );
  const noteMessage = (ctx: ResolvedHarnessContext, category: string) =>
    ctx.exportNotes.find(n => n.category === category)?.message;
  const javaNoteCategories = (ctx: ResolvedHarnessContext) =>
    noteCategories(ctx).filter(c => c.startsWith('Java export:'));

  it('defaults to Python/Strands when no language config is passed', () => {
    const { renderConfig, agentEnvSpec } = mapHarnessToExportConfig(baseContext());
    expect(renderConfig.targetLanguage).toBe('Python');
    expect(renderConfig.sdkFramework).toBe('Strands');
    expect(agentEnvSpec.runtimeVersion).toBeDefined();
  });

  it('renders a Container-only Bedrock Java agent with the placeholder entrypoint and no runtimeVersion', () => {
    const { renderConfig, agentEnvSpec } = mapHarnessToExportConfig(
      baseContext({ model: { provider: 'bedrock', modelId: 'us.amazon.nova-pro-v1:0' } }),
      undefined,
      JAVA
    );
    expect(renderConfig.targetLanguage).toBe('Java');
    expect(renderConfig.sdkFramework).toBe('SpringAI');
    expect(renderConfig.modelProvider).toBe('Bedrock');
    expect(renderConfig.buildType).toBe('Container');
    expect(renderConfig.modelId).toBe('us.amazon.nova-pro-v1:0');
    expect(agentEnvSpec.build).toBe('Container');
    expect(agentEnvSpec.entrypoint).toBe('main.py');
    expect(agentEnvSpec.runtimeVersion).toBeUndefined();
  });

  it('threads the harness system prompt into the render config for Java', () => {
    const ctx = baseContext({}, { systemPrompt: 'You are a payroll expert.' });
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.systemPromptText).toBe('You are a payroll expert.');
  });

  it('carries an existing-memory flag through to the Java render config', () => {
    const ctx = baseContext({ memory: { mode: 'existing', name: 'mem' } }, PROJECT_WITH_MEMORY);
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.hasMemory).toBe(true);
  });

  // Rejections — exact messages shared with the create/add gate and docs/frameworks.md
  it('rejects --build CodeZip for Java', () => {
    expect(() => mapHarnessToExportConfig(baseContext(), 'CodeZip', JAVA)).toThrow(
      '--build CodeZip is not supported for Java agents. Use --build Container or omit --build.'
    );
  });

  it.each([
    ['session storage', { sessionStoragePath: '/mnt/session' }],
    [
      'an EFS access point',
      {
        networkMode: 'VPC',
        efsAccessPoints: [
          {
            accessPointArn: 'arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-1',
            mountPath: '/mnt/efs',
          },
        ],
      },
    ],
    [
      'an S3 access point',
      {
        networkMode: 'VPC',
        s3AccessPoints: [{ accessPointArn: 'arn:aws:s3:us-east-1:123456789012:accesspoint/ap', mountPath: '/mnt/s3' }],
      },
    ],
  ])('rejects a harness with %s for Java', (_label, overrides) => {
    expect(() => mapHarnessToExportConfig(baseContext(overrides as Partial<HarnessSpec>), undefined, JAVA)).toThrow(
      'Filesystem mounts are not supported for Java agents. Remove --session-storage-mount-path, --efs-access-point-arn, and --s3-access-point-arn.'
    );
  });

  it('rejects a containerUri or dockerfile harness for Java', () => {
    const message =
      'Java export does not support a custom containerUri or dockerfile; the generated agent ships its own Dockerfile. Remove them or export the harness as Python.';
    expect(() =>
      mapHarnessToExportConfig(
        baseContext({ containerUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/base:latest' }),
        undefined,
        JAVA
      )
    ).toThrow(message);
    expect(() => mapHarnessToExportConfig(baseContext({ dockerfile: 'Dockerfile.custom' }), undefined, JAVA)).toThrow(
      message
    );
  });

  it.each([
    ['OpenAI', { provider: 'open_ai', modelId: 'gpt-4.1', apiKeyArn: OPENAI_KEY_ARN }],
    ['LiteLLM', { provider: 'lite_llm', modelId: 'openai/gpt-4o' }],
    ['Bedrock Mantle', { provider: 'bedrock', modelId: 'openai.gpt-oss-120b', apiFormat: 'chat_completions' }],
  ] as const)('rejects a %s model for Java', (provider, model) => {
    expect(() => mapHarnessToExportConfig(baseContext({ model: model as any }), undefined, JAVA)).toThrow(
      `${provider} model provider is not yet supported for Java agents. Use --model-provider Bedrock.`
    );
  });

  it('rejects header credentials for a remote MCP server for Java', () => {
    const ctx = baseContext({
      allowedTools: ['secure'],
      tools: [
        {
          type: 'remote_mcp',
          name: 'secure',
          config: { remoteMcp: { url: 'https://mcp.example.com/mcp', headers: { 'X-Api-Key': 'sk-123' } } },
        },
      ],
    });
    expect(() => mapHarnessToExportConfig(ctx, undefined, JAVA)).toThrow(
      'Authenticated remote MCP headers are not yet supported for Java agents. Remove the headers or export the harness as Python.'
    );
  });

  it('rejects a non-AWS_IAM gateway for Java', () => {
    const gatewayArn = 'arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/jwt123';
    const ctx = baseContext(
      {
        allowedTools: ['gw'],
        tools: [{ type: 'agentcore_gateway', name: 'gw', config: { agentCoreGateway: { gatewayArn } } }],
      },
      {
        deployedResources: { mcp: { gateways: { JwtGateway: { gatewayArn } } } } as any,
        projectSpec: {
          name: 'p',
          runtimes: [],
          memories: [],
          credentials: [],
          harnesses: [],
          agentCoreGateways: [{ name: 'JwtGateway', authorizerType: 'CUSTOM_JWT' }],
        } as any,
      }
    );
    expect(() => mapHarnessToExportConfig(ctx, undefined, JAVA)).toThrow(
      'Gateway "JwtGateway" uses CUSTOM_JWT; Java agents support only AWS_IAM gateways.'
    );
  });

  it('maps an AWS_IAM gateway for Java without notes about it', () => {
    const ctx = baseContext({
      allowedTools: ['gw'],
      tools: [
        {
          type: 'agentcore_gateway',
          name: 'gw',
          config: {
            agentCoreGateway: { gatewayArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/abc123' },
          },
        },
      ],
    });
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.hasGateway).toBe(true);
    expect(renderConfig.gatewayProviders).toHaveLength(1);
    expect(javaNoteCategories(ctx)).toEqual([JAVA_PAYLOAD_NOTE_CATEGORY]);
  });

  // Coverage notes — one per feature, exact wording
  it('always notes that the Java agent accepts a prompt-only payload', () => {
    const ctx = baseContext({ allowedTools: ['my-tool'] });
    mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(javaNoteCategories(ctx)).toEqual([JAVA_PAYLOAD_NOTE_CATEGORY]);
    expect(noteMessage(ctx, JAVA_PAYLOAD_NOTE_CATEGORY)).toBe(
      'The Java agent accepts {"prompt": …} only; messages/tool_results payload shapes are not yet supported.'
    );
  });

  it('emits no Java notes for a Python export', () => {
    const ctx = baseContext({ maxTokens: 1000 });
    mapHarnessToExportConfig(ctx);
    expect(javaNoteCategories(ctx)).toEqual([]);
  });

  it('notes the default Strands builtins (shell/file_operations) for Java', () => {
    const ctx = baseContext(); // wildcard allowedTools → builtins available in the harness
    mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(noteMessage(ctx, JAVA_BUILTIN_TOOLS_NOTE_CATEGORY)).toBe(
      'Java/SpringAI export does not yet support builtin shell or file_operations tools; they were omitted.'
    );
  });

  it('notes inline function tools with their count', () => {
    const ctx = baseContext({
      allowedTools: ['lookup', 'other'],
      tools: [
        {
          type: 'inline_function',
          name: 'lookup',
          config: { inlineFunction: { description: 'Look something up', inputSchema: { type: 'object' } } },
        },
        {
          type: 'inline_function',
          name: 'other',
          config: { inlineFunction: { description: 'Other', inputSchema: { type: 'object' } } },
        },
      ],
    });
    mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(noteMessage(ctx, JAVA_INLINE_TOOLS_NOTE_CATEGORY)).toBe(
      'Java/SpringAI export does not yet support inline function tools; 2 tool(s) were omitted. Export as Python if they are required.'
    );
  });

  it('notes maxTokens / maxIterations but not timeoutSeconds', () => {
    const plain = baseContext({ allowedTools: ['t'], timeoutSeconds: 30 });
    const { renderConfig } = mapHarnessToExportConfig(plain, undefined, JAVA);
    expect(renderConfig.timeoutSeconds).toBe(30);
    expect(renderConfig.hasExecutionLimits).toBe(true);
    expect(noteMessage(plain, JAVA_EXECUTION_LIMITS_NOTE_CATEGORY)).toBeUndefined();

    const budgeted = baseContext({ allowedTools: ['t'], timeoutSeconds: 30, maxTokens: 1000, maxIterations: 5 });
    mapHarnessToExportConfig(budgeted, undefined, JAVA);
    expect(noteMessage(budgeted, JAVA_EXECUTION_LIMITS_NOTE_CATEGORY)).toBe(
      'Java/SpringAI export does not yet enforce maxTokens or maxIterations; these values were omitted. timeoutSeconds is supported.'
    );
  });

  it('wires path and public-git skills without a note, and notes s3 / private-git skills once', () => {
    const wired = baseContext({
      allowedTools: ['t'],
      skills: [{ path: 'skills/greeting' }, { gitUrl: 'https://github.com/org/repo' }],
    });
    const { renderConfig } = mapHarnessToExportConfig(wired, undefined, JAVA);
    expect(renderConfig.hasSkillsFetcher).toBe(true);
    expect(renderConfig.pathSkills).toEqual(['skills/greeting']);
    expect(noteMessage(wired, JAVA_SKILLS_NOTE_CATEGORY)).toBeUndefined();

    const unwired = baseContext({
      allowedTools: ['t'],
      skills: [
        { s3Uri: 's3://bucket/skill' },
        { gitUrl: 'https://github.com/org/priv', auth: { credentialName: 'MyGitCred' } },
      ],
    });
    const omitted = mapHarnessToExportConfig(unwired, undefined, JAVA);
    expect(unwired.exportNotes.filter(n => n.category === JAVA_SKILLS_NOTE_CATEGORY)).toHaveLength(1);
    expect(noteMessage(unwired, JAVA_SKILLS_NOTE_CATEGORY)).toBe(
      'Java/SpringAI export supports path and public-git skills; s3 and private-git skills are not yet supported and were omitted.'
    );
    // Omitted skills contribute no fetcher, S3 permission, or credential grant.
    expect(omitted.renderConfig.hasSkillsFetcher).toBe(false);
    expect(omitted.renderConfig.s3Skills).toEqual([]);
    expect(omitted.renderConfig.gitSkills).toEqual([]);
    expect(unwired.generatedPolicyFiles).toEqual({});
    expect(unwired.additionalPolicies).toEqual([]);
    expect(omitted.gitCredentialEntries).toEqual([]);
  });

  it('notes AWS skills once, with their patterns', () => {
    const context = baseContext({
      allowedTools: ['t'],
      skills: [{ awsSkills: { paths: ['s3', 'lambda'] } }, { awsSkills: {} }],
    } as Partial<HarnessSpec>);
    const { renderConfig } = mapHarnessToExportConfig(context, undefined, JAVA);
    expect(renderConfig.hasSkillsFetcher).toBe(false);
    expect(context.exportNotes.filter(n => n.category === AWS_SKILLS_NOTE_CATEGORY)).toHaveLength(1);
    expect(noteMessage(context, AWS_SKILLS_NOTE_CATEGORY)).toContain(
      'not available in standalone Java agents. The following skill patterns have been omitted: s3, lambda; all.'
    );
  });

  it('keeps the s3 policy and git credential for the same skills in a Python export', () => {
    const ctx = baseContext({
      allowedTools: ['t'],
      skills: [
        { s3Uri: 's3://bucket/skill' },
        { gitUrl: 'https://github.com/org/priv', auth: { credentialName: 'MyGitCred' } },
      ],
    });
    const { renderConfig, gitCredentialEntries } = mapHarnessToExportConfig(ctx);
    expect(renderConfig.hasSkillsFetcher).toBe(true);
    expect(Object.keys(ctx.generatedPolicyFiles)).toEqual(['s3-skills-policy.json']);
    expect(gitCredentialEntries).toEqual([{ authorizerType: 'ApiKeyCredentialProvider', name: 'MyGitCred' }]);
  });

  it('notes the harness actorId when memory is existing and actorId is set', () => {
    const ctx = memCtx({ memory: { mode: 'existing', name: 'mem', actorId: 'alice' } });
    mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(noteMessage(ctx, JAVA_ACTOR_ID_NOTE_CATEGORY)).toBe(
      'Java export does not yet apply the harness actorId; the agent derives the actor from the runtime user-id header (default default-user).'
    );
    const without = memCtx({});
    mapHarnessToExportConfig(without, undefined, JAVA);
    expect(noteMessage(without, JAVA_ACTOR_ID_NOTE_CATEGORY)).toBeUndefined();
  });

  it('wires custom browser / code-interpreter identifiers and remote URL-only MCP for Java without notes', () => {
    const ctx = baseContext({
      allowedTools: ['browser', 'ci', 'weather'],
      tools: [
        {
          type: 'agentcore_browser',
          name: 'browser',
          config: {
            agentCoreBrowser: {
              browserArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:browser-custom/my_browser_id',
            },
          },
        },
        {
          type: 'agentcore_code_interpreter',
          name: 'ci',
          config: {
            agentCoreCodeInterpreter: {
              codeInterpreterArn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:code-interpreter-custom/my_ci_id',
            },
          },
        },
        { type: 'remote_mcp', name: 'weather', config: { remoteMcp: { url: 'https://mcp.example.com/mcp' } } },
      ],
    });
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.hasBrowser).toBe(true);
    expect(renderConfig.browserIdentifierEnvVar).toMatch(/^BROWSER_.*_ID$/);
    expect(renderConfig.hasCodeInterpreter).toBe(true);
    expect(renderConfig.codeInterpreterIdentifierEnvVar).toMatch(/^CODE_INTERPRETER_.*_ID$/);
    expect(renderConfig.remoteMcpTools).toHaveLength(1);
    expect(renderConfig.remoteMcpTools![0]!.url).toBe('https://mcp.example.com/mcp');
    expect(javaNoteCategories(ctx)).toEqual([JAVA_PAYLOAD_NOTE_CATEGORY]);
  });

  // Truncation → AgentCore Memory retrieval window
  it('maps sliding_window truncation to the retrieval window when memory is present, without a note', () => {
    const ctx = memCtx({
      truncation: { strategy: 'sliding_window', config: { slidingWindow: { messagesCount: 20 } } },
    });
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.hasMemory).toBe(true);
    expect(renderConfig.sessionTotalEventsLimit).toBe(20);
    expect(noteMessage(ctx, JAVA_TRUNCATION_NOTE_CATEGORY)).toBeUndefined();
  });

  it('maps summarization truncation via preserveRecentMessages and notes the missing summarizer', () => {
    const ctx = memCtx({
      truncation: {
        strategy: 'summarization',
        config: { summarization: { preserveRecentMessages: 8, summaryRatio: 0.3 } },
      },
    });
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.sessionTotalEventsLimit).toBe(8);
    expect(noteMessage(ctx, JAVA_TRUNCATION_NOTE_CATEGORY)).toBe(
      'Java/SpringAI maps the truncation limit to the AgentCore Memory retrieval window; an in-process summarization component is not yet supported.'
    );
  });

  it('does not render truncation without memory and notes it', () => {
    const ctx = baseContext({
      allowedTools: ['t'],
      truncation: { strategy: 'sliding_window', config: { slidingWindow: { messagesCount: 20 } } },
    });
    const { renderConfig } = mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(renderConfig.sessionTotalEventsLimit).toBeUndefined();
    expect(noteMessage(ctx, JAVA_TRUNCATION_NOTE_CATEGORY)).toBe(
      'Java truncation requires AgentCore Memory. Add memory or remove truncation; the generated Java agent does not include truncation.'
    );
  });

  it('emits no internal roadmap wording in any Java note', () => {
    const ctx = baseContext({
      skills: [{ s3Uri: 's3://bucket/skill' }],
      tools: [
        {
          type: 'inline_function',
          name: 'lookup',
          config: { inlineFunction: { description: 'Look something up', inputSchema: { type: 'object' } } },
        },
      ],
      maxIterations: 5,
      truncation: { strategy: 'sliding_window', config: { slidingWindow: { messagesCount: 20 } } },
    });
    mapHarnessToExportConfig(ctx, undefined, JAVA);
    const javaNotes = ctx.exportNotes.filter(n => n.category.startsWith('Java export:'));
    expect(javaNotes.length).toBeGreaterThanOrEqual(5);
    for (const n of javaNotes) {
      expect(n.message).not.toMatch(/Phase|Session API|2\.2\.0|slice|wired/i);
    }
  });

  it('rejects a same-project memory with the EPISODIC strategy', () => {
    const ctx = baseContext(
      { memory: { mode: 'existing', name: 'EpMem' } },
      {
        projectSpec: {
          name: 'p',
          runtimes: [],
          memories: [{ name: 'EpMem', strategies: [{ type: 'SEMANTIC' }, { type: 'EPISODIC' }] }],
          credentials: [],
          harnesses: [],
        } as any,
      }
    );
    expect(() => mapHarnessToExportConfig(ctx, undefined, JAVA)).toThrow(
      'Memory "EpMem" uses the EPISODIC strategy, which is not yet supported for Java agents. Use a memory without EPISODIC or export the harness as Python.'
    );
    expect(() => mapHarnessToExportConfig(ctx)).not.toThrow();
  });

  it('notes that an external memory was not checked for EPISODIC', () => {
    const ctx = baseContext({
      memory: { mode: 'existing', arn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:memory/ext-abc' },
    });
    mapHarnessToExportConfig(ctx, undefined, JAVA);
    expect(noteMessage(ctx, JAVA_EXTERNAL_MEMORY_NOTE_CATEGORY)).toContain('EPISODIC');
  });
});
