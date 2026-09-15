import type { GenerateConfig } from '../../generate/types';
import { buildCreateAgentConfig } from '../buildCreateAgentConfig';
import { addAgentInner } from '../useAddAgent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReadProjectSpec, mockCreateRenderer } = vi.hoisted(() => ({
  mockReadProjectSpec: vi.fn(),
  mockCreateRenderer: vi.fn(),
}));

vi.mock('../../../../../lib', async importActual => ({
  ...(await importActual<typeof import('../../../../../lib')>()),
  findConfigRoot: () => '/project/agentcore',
  ConfigIO: vi.fn(function (this: Record<string, unknown>) {
    this.configExists = () => true;
    this.readProjectSpec = mockReadProjectSpec;
  }),
}));

vi.mock('../../../../templates', () => ({ createRenderer: mockCreateRenderer }));

function javaConfig(overrides: Partial<GenerateConfig> = {}) {
  return buildCreateAgentConfig('JavaAgent', {
    projectName: 'JavaAgent',
    language: 'Java',
    buildType: 'Container',
    protocol: 'HTTP',
    sdk: 'SpringAI',
    modelProvider: 'Bedrock',
    memory: 'none',
    ...overrides,
  });
}

describe('addAgentInner — Java language matrix', () => {
  beforeEach(() => {
    mockCreateRenderer.mockReset();
    mockReadProjectSpec.mockResolvedValue({ runtimes: [], agentCoreGateways: [] });
  });

  it('rejects a config bundle before writing anything', async () => {
    const result = await addAgentInner(javaConfig({ withConfigBundle: true }));
    expect(result).toMatchObject({ success: false });
    expect(!result.success && result.error.message).toBe('--with-config-bundle is not supported for Java agents.');
    expect(mockCreateRenderer).not.toHaveBeenCalled();
  });

  it.each(['CUSTOM_JWT', 'NONE'])('rejects an existing %s gateway', async authorizerType => {
    mockReadProjectSpec.mockResolvedValue({
      runtimes: [],
      agentCoreGateways: [{ name: 'tools-gw', authorizerType }],
    });
    const result = await addAgentInner(javaConfig());
    expect(!result.success && result.error.message).toBe(
      `Gateway "tools-gw" uses ${authorizerType}; Java agents support only AWS_IAM gateways.`
    );
    expect(mockCreateRenderer).not.toHaveBeenCalled();
  });
});
