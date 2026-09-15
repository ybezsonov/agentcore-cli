import type { AgentCoreProjectSpec } from '../../../schema';
import type { ValidationResult } from '../add/validate';

export interface LanguageMatrixOptions {
  language?: string;
  framework?: string;
  protocol?: string;
  modelProvider?: string;
  build?: string;
  memory?: string;
  sessionStorageMountPath?: string;
  efsAccessPointArn?: string[];
  efsMountPath?: string[];
  s3AccessPointArn?: string[];
  s3MountPath?: string[];
  withConfigBundle?: boolean;
}

export interface GatewayForLanguageValidation {
  name: string;
  authorizerType: string;
}

export const JAVA_PAYMENTS_WARNING =
  'This project contains payment configuration for another agent; payments are not available to the new Java agent.';

/**
 * Fills in the Java defaults that the SpringAI template profile cannot express. The profile then
 * fills in the build and the model provider.
 */
export function applyJavaDefaults(options: {
  language?: string;
  framework?: string;
  protocol?: string;
  memory?: string;
}) {
  if (options.language !== 'Java' && options.framework !== 'SpringAI') return;
  options.framework ??= 'SpringAI';
  options.protocol ??= 'HTTP';
  options.memory ??= 'none';
}

/** Checks a new agent against the language matrix and the project it joins. */
export function validateNewAgentLanguage(
  options: LanguageMatrixOptions,
  project: Pick<AgentCoreProjectSpec, 'agentCoreGateways' | 'payments'>
): ValidationResult & { warnings: string[] } {
  const result = validateLanguageMatrix(options, project.agentCoreGateways);
  const hasPayments = options.language === 'Java' && (project.payments ?? []).length > 0;
  return { ...result, warnings: result.valid && hasPayments ? [JAVA_PAYMENTS_WARNING] : [] };
}

export function validateLanguageMatrix(
  options: LanguageMatrixOptions,
  gateways: GatewayForLanguageValidation[] = []
): ValidationResult {
  if (options.language !== 'Java') return { valid: true };

  const protocol = options.protocol ?? 'HTTP';
  const framework = options.framework ?? 'SpringAI';
  const modelProvider = options.modelProvider ?? 'Bedrock';
  const build = options.build ?? 'Container';

  if (build === 'CodeZip') {
    return {
      valid: false,
      error: '--build CodeZip is not supported for Java agents. Use --build Container or omit --build.',
    };
  }

  if (protocol !== 'HTTP') {
    return {
      valid: false,
      error: `${protocol} protocol is not yet supported for Java agents. Use --protocol HTTP.`,
    };
  }
  if (framework !== 'SpringAI') {
    return {
      valid: false,
      error: `Framework ${framework} is not yet available for Java agents. Use --framework SpringAI.`,
    };
  }
  if (modelProvider !== 'Bedrock') {
    return {
      valid: false,
      error: `${modelProvider} model provider is not yet supported for Java agents. Use --model-provider Bedrock.`,
    };
  }

  const hasFilesystem =
    !!options.sessionStorageMountPath ||
    !!options.efsAccessPointArn?.length ||
    !!options.efsMountPath?.length ||
    !!options.s3AccessPointArn?.length ||
    !!options.s3MountPath?.length;
  if (hasFilesystem) {
    return {
      valid: false,
      error:
        'Filesystem mounts are not supported for Java agents. Remove --session-storage-mount-path, --efs-access-point-arn, and --s3-access-point-arn.',
    };
  }
  if (options.withConfigBundle) {
    return { valid: false, error: '--with-config-bundle is not supported for Java agents.' };
  }

  const unsupportedGateway = gateways.find(gateway => gateway.authorizerType !== 'AWS_IAM');
  if (unsupportedGateway) {
    return {
      valid: false,
      error: `Gateway "${unsupportedGateway.name}" uses ${unsupportedGateway.authorizerType}; Java agents support only AWS_IAM gateways.`,
    };
  }

  return { valid: true };
}
