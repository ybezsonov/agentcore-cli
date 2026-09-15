export const EXPORT_NOTES_FILENAME = 'EXPORT_NOTES.md';

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

export const CONTAINER_URI_NOTE_CATEGORY = 'containerUri: verify Python in base image';
export const CUSTOM_DOCKERFILE_NOTE_CATEGORY = 'Custom harness Dockerfile needs the agent build layer';
export const CONTAINER_URI_ECR_PULL_NOTE_CATEGORY = 'containerUri base image requires ECR pull permission';
export const ALLOWED_TOOLS_NOTE_CATEGORY = 'allowedTools: per-invocation overrides dropped';
export const PATH_SKILLS_NOTE_CATEGORY = 'path skills require container filesystem';
export const PATH_SKILLS_COPIED_NOTE_CATEGORY = 'path skills copied into agent directory';
export const PATH_SKILLS_VERIFY_BASE_IMAGE_NOTE_CATEGORY =
  'path skill not found locally — verify it exists in the base image';
export const MCP_HEADER_CREDS_NOTE_CATEGORY = 'MCP tool header credentials';
export const GIT_SKILLS_CONTAINER_NOTE_CATEGORY = 'git skills require git in container image';
export const GIT_SKILLS_CLONED_NOTE_CATEGORY = 'public git skills cloned into agent directory';
export const GIT_SKILLS_CLONE_FAILED_NOTE_CATEGORY = 'public git skill could not be cloned at export';
export const GATEWAY_GRANT_TYPE_NOTE_CATEGORY = 'Gateway OAuth grant type not supported by generated client (M2M only)';
export const BROWSER_CODZIP_NOTE_CATEGORY = 'Browser tool requires Container build — excluded from CodeZip export';
export const AWS_SKILLS_NOTE_CATEGORY = 'AWS skills omitted — not available outside managed harness';
export const MALFORMED_TOOL_ARN_NOTE_CATEGORY = 'Browser/code-interpreter ARN is malformed — using AWS-managed default';
export const MALFORMED_S3_SKILL_NOTE_CATEGORY = 'S3 skill URI is malformed — no S3 read permission generated';
export const LITELLM_NO_API_KEY_NOTE_CATEGORY = 'LiteLLM model may require an API key';
export const JAVA_TRUNCATION_NOTE_CATEGORY = 'Java export: truncation';
export const JAVA_EXECUTION_LIMITS_NOTE_CATEGORY = 'Java export: maxTokens / maxIterations omitted';
export const JAVA_INLINE_TOOLS_NOTE_CATEGORY = 'Java export: inline function tools omitted';
export const JAVA_BUILTIN_TOOLS_NOTE_CATEGORY = 'Java export: builtin shell / file_operations tools omitted';
export const JAVA_SKILLS_NOTE_CATEGORY = 'Java export: s3 / private-git skills omitted';
export const JAVA_ACTOR_ID_NOTE_CATEGORY = 'Java export: harness actorId not applied';
export const JAVA_PAYLOAD_NOTE_CATEGORY = 'Java export: prompt-only invocation payload';
