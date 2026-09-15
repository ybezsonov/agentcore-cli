import { validateLanguageMatrix } from '../validate-language-matrix.js';
import { describe, expect, it } from 'vitest';

describe('validateLanguageMatrix', () => {
  it('validates Java defaults without mutating the input', () => {
    const options = Object.freeze({ language: 'Java' });
    expect(validateLanguageMatrix(options)).toEqual({ valid: true });
    expect(options).toEqual({ language: 'Java' });
  });

  it.each([
    ['MCP', 'MCP protocol is not yet supported for Java agents. Use --protocol HTTP.'],
    ['A2A', 'A2A protocol is not yet supported for Java agents. Use --protocol HTTP.'],
  ])('rejects protocol %s', (protocol, error) => {
    expect(validateLanguageMatrix({ language: 'Java', protocol })).toEqual({ valid: false, error });
  });

  it('rejects unsupported framework, provider, and CodeZip with normative messages', () => {
    expect(validateLanguageMatrix({ language: 'Java', framework: 'Strands' })).toEqual({
      valid: false,
      error: 'Framework Strands is not yet available for Java agents. Use --framework SpringAI.',
    });
    expect(validateLanguageMatrix({ language: 'Java', modelProvider: 'OpenAI' })).toEqual({
      valid: false,
      error: 'OpenAI model provider is not yet supported for Java agents. Use --model-provider Bedrock.',
    });
    expect(validateLanguageMatrix({ language: 'Java', build: 'CodeZip' })).toEqual({
      valid: false,
      error: '--build CodeZip is not supported for Java agents. Use --build Container or omit --build.',
    });
  });

  it('rejects filesystem mounts and config bundles', () => {
    expect(validateLanguageMatrix({ language: 'Java', sessionStorageMountPath: '/mnt/x' }).error).toBe(
      'Filesystem mounts are not supported for Java agents. Remove --session-storage-mount-path, --efs-access-point-arn, and --s3-access-point-arn.'
    );
    expect(validateLanguageMatrix({ language: 'Java', withConfigBundle: true }).error).toBe(
      '--with-config-bundle is not supported for Java agents.'
    );
  });

  it('rejects non-IAM gateways and accepts IAM gateways', () => {
    expect(validateLanguageMatrix({ language: 'Java' }, [{ name: 'gw', authorizerType: 'CUSTOM_JWT' }])).toEqual({
      valid: false,
      error: 'Gateway "gw" uses CUSTOM_JWT; Java agents support only AWS_IAM gateways.',
    });
    expect(validateLanguageMatrix({ language: 'Java' }, [{ name: 'gw', authorizerType: 'AWS_IAM' }])).toEqual({
      valid: true,
    });
  });
});
