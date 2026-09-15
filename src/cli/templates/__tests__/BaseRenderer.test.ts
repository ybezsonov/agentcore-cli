import { BaseRenderer } from '../BaseRenderer.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCopyAndRenderDir = vi.fn();

vi.mock('../render.js', () => ({
  copyAndRenderDir: (...args: unknown[]) => mockCopyAndRenderDir(...args),
}));

class TestRenderer extends BaseRenderer {
  constructor(config: any, sdkName: string, baseTemplateDir: string, protocol?: string) {
    super(config, sdkName, baseTemplateDir, protocol);
  }

  getTemplateDirPublic(): string {
    return this.getTemplateDir();
  }
}

describe('BaseRenderer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'base-renderer-test-'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('getTemplateDir joins language, protocol, and sdk name', () => {
    const renderer = new TestRenderer(
      { targetLanguage: 'Python', name: 'MyAgent', hasMemory: false },
      'strands',
      '/templates'
    );

    expect(renderer.getTemplateDirPublic()).toBe('/templates/python/http/strands');
  });

  it('getTemplateDir uses protocol from config', () => {
    const renderer = new TestRenderer(
      { targetLanguage: 'Python', name: 'MyAgent', hasMemory: false, protocol: 'A2A' },
      'strands',
      '/templates'
    );

    expect(renderer.getTemplateDirPublic()).toBe('/templates/python/a2a/strands');
  });

  it('getTemplateDir uses explicit protocol over config', () => {
    const renderer = new TestRenderer(
      { targetLanguage: 'Python', name: 'MyAgent', hasMemory: false, protocol: 'A2A' },
      'standalone',
      '/templates',
      'mcp'
    );

    expect(renderer.getTemplateDirPublic()).toBe('/templates/python/mcp/standalone');
  });

  it('render copies base template', async () => {
    mockCopyAndRenderDir.mockResolvedValue(undefined);

    const renderer = new TestRenderer(
      { targetLanguage: 'Python', name: 'MyAgent', hasMemory: false },
      'strands',
      tmpDir
    );

    await renderer.render({ outputDir: '/output' });

    expect(mockCopyAndRenderDir).toHaveBeenCalledTimes(1);
    expect(mockCopyAndRenderDir).toHaveBeenCalledWith(
      join(tmpDir, 'python', 'http', 'strands', 'base'),
      '/output/app/MyAgent',
      expect.objectContaining({ projectName: 'MyAgent', Name: 'MyAgent' })
    );
  });

  it('render copies memory capability when hasMemory and dir exists', async () => {
    mockCopyAndRenderDir.mockResolvedValue(undefined);
    mkdirSync(join(tmpDir, 'typescript', 'http', 'langchain', 'capabilities', 'memory'), { recursive: true });

    const renderer = new TestRenderer(
      { targetLanguage: 'TypeScript', name: 'Agent', hasMemory: true },
      'langchain',
      tmpDir
    );

    await renderer.render({ outputDir: '/out' });

    expect(mockCopyAndRenderDir).toHaveBeenCalledTimes(2);
    expect(mockCopyAndRenderDir).toHaveBeenCalledWith(
      join(tmpDir, 'typescript', 'http', 'langchain', 'capabilities', 'memory'),
      '/out/app/Agent/memory',
      expect.objectContaining({ projectName: 'Agent', hasMemory: true })
    );
  });

  it('render skips memory capability when dir does not exist', async () => {
    mockCopyAndRenderDir.mockResolvedValue(undefined);

    const renderer = new TestRenderer({ targetLanguage: 'Python', name: 'Agent', hasMemory: true }, 'strands', tmpDir);

    await renderer.render({ outputDir: '/out' });

    expect(mockCopyAndRenderDir).toHaveBeenCalledTimes(1);
  });

  it('renders Java capabilities at the project root', async () => {
    mockCopyAndRenderDir.mockResolvedValue(undefined);
    for (const capability of ['env-bridge', 'memory', 'gateway', 'skills']) {
      mkdirSync(join(tmpDir, 'java', 'http', 'spring', 'capabilities', capability), { recursive: true });
    }

    const renderer = new TestRenderer(
      {
        targetLanguage: 'Java',
        name: 'Agent',
        hasMemory: true,
        hasGateway: true,
        hasSkillsFetcher: true,
      },
      'spring',
      tmpDir
    );

    await renderer.render({ outputDir: '/out' });

    for (const capability of ['env-bridge', 'memory', 'gateway', 'skills']) {
      expect(mockCopyAndRenderDir).toHaveBeenCalledWith(
        join(tmpDir, 'java', 'http', 'spring', 'capabilities', capability),
        '/out/app/Agent',
        expect.objectContaining({ projectName: 'Agent' })
      );
    }
  });

  it('renders Java execution limits only for timeoutSeconds', async () => {
    mockCopyAndRenderDir.mockResolvedValue(undefined);
    const capabilityDir = join(tmpDir, 'java', 'http', 'spring', 'capabilities', 'execution-limits');
    mkdirSync(capabilityDir, { recursive: true });

    const budgetOnly = new TestRenderer(
      { targetLanguage: 'Java', name: 'Agent', hasMemory: false, maxTokens: 100 },
      'spring',
      tmpDir
    );
    await budgetOnly.render({ outputDir: '/out' });
    expect(mockCopyAndRenderDir).not.toHaveBeenCalledWith(capabilityDir, '/out/app/Agent', expect.anything());

    vi.clearAllMocks();
    mockCopyAndRenderDir.mockResolvedValue(undefined);
    const timeout = new TestRenderer(
      { targetLanguage: 'Java', name: 'Agent', hasMemory: false, timeoutSeconds: 60 },
      'spring',
      tmpDir
    );
    await timeout.render({ outputDir: '/out' });
    expect(mockCopyAndRenderDir).toHaveBeenCalledWith(capabilityDir, '/out/app/Agent', expect.anything());
  });
});
