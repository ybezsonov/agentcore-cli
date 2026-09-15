import type { AddAgentOptions } from '../../add/types.js';
import { validateAddAgentOptions } from '../../add/validate.js';
import { validateCreateOptions } from '../../create/validate.js';
import { JAVA_PAYMENTS_WARNING, validateNewAgentLanguage } from '../validate-language-matrix.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CODEZIP_ERROR = '--build CodeZip is not supported for Java agents. Use --build Container or omit --build.';

describe('Java options in add agent', () => {
  it('fills in the Java defaults from --language Java or --framework SpringAI', () => {
    const cases: AddAgentOptions[] = [
      { name: 'JavaAgent', language: 'Java' },
      { name: 'JavaAgent', framework: 'SpringAI' as AddAgentOptions['framework'] },
    ];
    for (const options of cases) {
      expect(validateAddAgentOptions(options)).toEqual({ valid: true });
      expect(options).toMatchObject({
        language: 'Java',
        framework: 'SpringAI',
        protocol: 'HTTP',
        modelProvider: 'Bedrock',
        memory: 'none',
        build: 'Container',
      });
    }
  });

  it('reports the language matrix message before the template profile message', () => {
    expect(validateAddAgentOptions({ name: 'JavaAgent', language: 'Java', build: 'CodeZip' })).toEqual({
      valid: false,
      error: CODEZIP_ERROR,
    });
  });

  it('accepts --system-prompt for a Java create agent and rejects it elsewhere', () => {
    const java = { name: 'JavaAgent', language: 'Java' as const, systemPrompt: 'You plan trips.' };
    expect(validateAddAgentOptions({ ...java }).valid).toBe(true);
    expect(validateAddAgentOptions({ ...java, systemPrompt: '   ' })).toEqual({
      valid: false,
      error: '--system-prompt must not be empty',
    });
    expect(
      validateAddAgentOptions({
        name: 'PyAgent',
        type: 'byo',
        language: 'Python',
        framework: 'Strands',
        modelProvider: 'Bedrock',
        codeLocation: '/path/to/code',
        systemPrompt: 'You plan trips.',
      })
    ).toEqual({ valid: false, error: '--system-prompt is supported only when creating a Java agent' });
  });
});

describe('Java options in create', () => {
  let cwd: string;
  beforeAll(() => {
    cwd = join(tmpdir(), `create-java-${randomUUID()}`);
    mkdirSync(cwd, { recursive: true });
  });
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  it('reports the language matrix message for --build CodeZip', () => {
    expect(validateCreateOptions({ name: 'JavaProject', language: 'Java', build: 'CodeZip' }, cwd)).toEqual({
      valid: false,
      error: CODEZIP_ERROR,
    });
  });

  it('rejects a Java import with the language matrix message', () => {
    const options = {
      name: 'JavaImport',
      type: 'import',
      language: 'java',
      framework: 'Strands',
      agentId: 'AGENT12345',
      agentAliasId: 'ALIAS12345',
      region: 'us-east-1',
    };
    expect(validateCreateOptions(options, cwd)).toEqual({
      valid: false,
      error: 'Framework Strands is not yet available for Java agents. Use --framework SpringAI.',
    });
    expect(validateCreateOptions({ ...options, language: 'Python' }, cwd)).toEqual({ valid: true });
  });
});

describe('validateNewAgentLanguage', () => {
  const iamGateway = { name: 'Tools', authorizerType: 'AWS_IAM' };

  it('warns when a Java agent joins a project with payments', () => {
    const project = { agentCoreGateways: [iamGateway], payments: [{}] } as never;
    expect(validateNewAgentLanguage({ language: 'Java' }, project)).toEqual({
      valid: true,
      warnings: [JAVA_PAYMENTS_WARNING],
    });
    expect(validateNewAgentLanguage({ language: 'Python' }, project)).toEqual({ valid: true, warnings: [] });
  });

  it('rejects a Java agent in a project with a non-IAM gateway', () => {
    const project = { agentCoreGateways: [{ name: 'Open', authorizerType: 'NONE' }] } as never;
    expect(validateNewAgentLanguage({ language: 'Java' }, project)).toEqual({
      valid: false,
      error: 'Gateway "Open" uses NONE; Java agents support only AWS_IAM gateways.',
      warnings: [],
    });
  });
});
