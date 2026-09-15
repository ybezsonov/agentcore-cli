import { ValidationError } from '../../../../lib/errors/types';
import type { BuildType } from '../../../../schema';
import type { HarnessSpec, HarnessTruncationConfig } from '../../../../schema/schemas/primitives/harness';
import type { AgentRenderConfig } from '../../../templates/types';
import { validateLanguageMatrix } from '../../shared/validate-language-matrix';
import { AWS_SKILLS_NOTE_CATEGORY } from '../constants';
import { isAwsSkill, isBedrockMantleModel, isGitSkill, isPathSkill, isS3Skill } from '../harness-mapper';
import type { ExportLanguageConfig, ResolvedHarnessContext } from '../types';
import {
  JAVA_ACTOR_ID_NOTE_CATEGORY,
  JAVA_BUILTIN_TOOLS_NOTE_CATEGORY,
  JAVA_EXECUTION_LIMITS_NOTE_CATEGORY,
  JAVA_EXTERNAL_MEMORY_NOTE_CATEGORY,
  JAVA_INLINE_TOOLS_NOTE_CATEGORY,
  JAVA_PAYLOAD_NOTE_CATEGORY,
  JAVA_SKILLS_NOTE_CATEGORY,
  JAVA_TRUNCATION_NOTE_CATEGORY,
} from './constants';

/**
 * Rejects the harness settings a Java export does not support, before any config is built, and
 * returns the harness with only the skills Java stages (path and public git). The s3 and private
 * git skills are left out, so they get no S3 policy, credential, or fetcher config either; the
 * coverage note reports them. Messages match the create/add matrix and docs/frameworks.md.
 */
export function prepareJavaExportSpec(spec: HarnessSpec, buildOverride?: BuildType): HarnessSpec {
  const matrix = validateLanguageMatrix({
    language: 'Java',
    build: buildOverride,
    sessionStorageMountPath: spec.sessionStoragePath,
    efsAccessPointArn: spec.efsAccessPoints?.map(ap => ap.accessPointArn),
    s3AccessPointArn: spec.s3AccessPoints?.map(ap => ap.accessPointArn),
  });
  if (!matrix.valid) throw new ValidationError(matrix.error!);
  if (spec.containerUri || spec.dockerfile) {
    throw new ValidationError(
      'Java export does not support a custom containerUri or dockerfile; the generated agent ships its own ' +
        'Dockerfile. Remove them or export the harness as Python.'
    );
  }
  if (spec.model.provider !== 'bedrock' || isBedrockMantleModel(spec)) {
    const provider =
      spec.model.provider === 'open_ai'
        ? 'OpenAI'
        : spec.model.provider === 'gemini'
          ? 'Gemini'
          : spec.model.provider === 'lite_llm'
            ? 'LiteLLM'
            : 'Bedrock Mantle';
    throw new ValidationError(
      `${provider} model provider is not yet supported for Java agents. Use --model-provider Bedrock.`
    );
  }
  return { ...spec, skills: spec.skills.filter(s => isPathSkill(s) || (isGitSkill(s) && !s.auth?.credentialName)) };
}

/** Rejects the resolved memory, gateway, and MCP settings a Java agent cannot use. */
function assertJavaConnectionsSupported(
  renderConfig: Pick<AgentRenderConfig, 'memoryProviders' | 'gatewayProviders' | 'remoteMcpTools'>,
  context: ResolvedHarnessContext,
  hasExternalMemory: boolean
): void {
  // The Spring AI AgentCore SDK also reads the episodic reflection namespace, which the deployed
  // runtime role is not yet granted, so a memory with EPISODIC fails at the first recall.
  const episodic = renderConfig.memoryProviders.find(memory => memory.strategies.includes('EPISODIC'));
  if (episodic) {
    throw new ValidationError(
      `Memory "${episodic.name}" uses the EPISODIC strategy, which is not yet supported for Java agents. ` +
        'Use a memory without EPISODIC or export the harness as Python.'
    );
  }
  if (hasExternalMemory) {
    context.exportNotes.push({
      category: JAVA_EXTERNAL_MEMORY_NOTE_CATEGORY,
      message:
        'The harness memory is outside this project, so its strategies were not checked. Java agents do not yet ' +
        'support the EPISODIC strategy; use a memory without it.',
    });
  }
  if ((renderConfig.remoteMcpTools ?? []).some(tool => (tool.headerCredentials?.length ?? 0) > 0)) {
    throw new ValidationError(
      'Authenticated remote MCP headers are not yet supported for Java agents. Remove the headers or export the harness as Python.'
    );
  }
  const unsupportedGateway = renderConfig.gatewayProviders.find(gateway => gateway.authType !== 'AWS_IAM');
  if (unsupportedGateway) {
    throw new ValidationError(
      `Gateway "${unsupportedGateway.name}" uses ${unsupportedGateway.authType}; Java agents support only AWS_IAM gateways.`
    );
  }
}

/**
 * Turns the Python render config into the Java one. Rejects the memory, gateway, and MCP settings
 * Java cannot use, and notes every harness feature Java leaves out.
 */
export function applyJavaRenderConfig(
  renderConfig: AgentRenderConfig,
  langConfig: ExportLanguageConfig,
  context: ResolvedHarnessContext,
  hasExternalMemory: boolean
): void {
  assertJavaConnectionsSupported(renderConfig, context, hasExternalMemory);
  renderConfig.targetLanguage = langConfig.targetLanguage;
  renderConfig.sdkFramework = langConfig.sdkFramework;
  renderConfig.enableOtel = false;
  renderConfig.systemPrompt = context.systemPrompt;
  // The truncation limit becomes the AgentCore Memory retrieval window, so it needs memory.
  if (renderConfig.hasMemory) renderConfig.sessionTotalEventsLimit = resolveSessionEventsLimit(context.spec.truncation);
  pushJavaCoverageNotes(renderConfig, context);
}

/**
 * The retrieval-window size (`agentcore.memory.short-term.total-events-limit`): sliding_window uses
 * messagesCount, summarization uses preserveRecentMessages.
 */
function resolveSessionEventsLimit(truncation: HarnessTruncationConfig | undefined): number | undefined {
  const config = truncation?.config;
  if (!config) return undefined;
  if (truncation.strategy === 'sliding_window' && 'slidingWindow' in config) {
    return config.slidingWindow?.messagesCount;
  }
  if (truncation.strategy === 'summarization' && 'summarization' in config) {
    return (config.summarization as { preserveRecentMessages?: number })?.preserveRecentMessages;
  }
  return undefined;
}

/**
 * Surface every harness feature the generated Java agent does not carry as its own export note, so
 * nothing is dropped silently. One note per feature; wording matches docs/frameworks.md.
 */
function pushJavaCoverageNotes(renderConfig: AgentRenderConfig, context: ResolvedHarnessContext): void {
  const note = (category: string, message: string) => context.exportNotes.push({ category, message });

  const truncation = renderConfig.truncationStrategy;
  if (truncation && truncation !== 'none') {
    if (!renderConfig.hasMemory) {
      note(
        JAVA_TRUNCATION_NOTE_CATEGORY,
        'Java truncation requires AgentCore Memory. Add memory or remove truncation; the generated Java agent ' +
          'does not include truncation.'
      );
    } else if (truncation === 'summarization') {
      note(
        JAVA_TRUNCATION_NOTE_CATEGORY,
        'Java/SpringAI maps the truncation limit to the AgentCore Memory retrieval window; an in-process ' +
          'summarization component is not yet supported.'
      );
    }
  }
  if (renderConfig.maxTokens !== undefined || renderConfig.maxIterations !== undefined) {
    note(
      JAVA_EXECUTION_LIMITS_NOTE_CATEGORY,
      'Java/SpringAI export does not yet enforce maxTokens or maxIterations; these values were omitted. ' +
        'timeoutSeconds is supported.'
    );
  }
  const inlineToolCount = renderConfig.inlineFunctionTools?.length ?? 0;
  if (inlineToolCount > 0) {
    note(
      JAVA_INLINE_TOOLS_NOTE_CATEGORY,
      `Java/SpringAI export does not yet support inline function tools; ${inlineToolCount} tool(s) were omitted. ` +
        'Export as Python if they are required.'
    );
  }
  if (renderConfig.hasShell || renderConfig.hasFileOperations) {
    note(
      JAVA_BUILTIN_TOOLS_NOTE_CATEGORY,
      'Java/SpringAI export does not yet support builtin shell or file_operations tools; they were omitted.'
    );
  }
  const hasUnsupportedSkills = context.spec.skills.some(
    skill => isS3Skill(skill) || (isGitSkill(skill) && skill.auth?.credentialName)
  );
  if (hasUnsupportedSkills) {
    note(
      JAVA_SKILLS_NOTE_CATEGORY,
      'Java/SpringAI export supports path and public-git skills; s3 and private-git skills are not yet supported ' +
        'and were omitted.'
    );
  }
  // The shared AWS-skills note never sees these: prepareJavaExportSpec filtered them out.
  const awsSkills = context.spec.skills.filter(isAwsSkill);
  if (awsSkills.length > 0) {
    const patterns = awsSkills.map(s => s.awsSkills.paths?.join(', ') ?? 'all').join('; ');
    note(
      AWS_SKILLS_NOTE_CATEGORY,
      `AWS skills are a managed harness feature and are not available in standalone Java agents. ` +
        `The following skill patterns have been omitted: ${patterns}. ` +
        `You can copy the equivalent skills from https://github.com/aws/agent-toolkit-for-aws/tree/main/skills ` +
        `into the harness and add them as path or git skills instead.`
    );
  }
  if (renderConfig.actorId) {
    note(
      JAVA_ACTOR_ID_NOTE_CATEGORY,
      'Java export does not yet apply the harness actorId; the agent derives the actor from the runtime user-id header (default default-user).'
    );
  }
  note(
    JAVA_PAYLOAD_NOTE_CATEGORY,
    'The Java agent accepts {"prompt": …} only; messages/tool_results payload shapes are not yet supported.'
  );
}
