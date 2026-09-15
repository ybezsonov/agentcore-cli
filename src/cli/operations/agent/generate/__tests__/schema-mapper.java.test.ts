import type { GenerateConfig } from '../../../../tui/screens/generate/types.js';
import {
  mapGenerateConfigToAgent,
  mapGenerateConfigToRenderConfig,
  mapGenerateInputToMemories,
} from '../schema-mapper.js';
import { describe, expect, it } from 'vitest';

const javaConfig: GenerateConfig = {
  projectName: 'JavaAgent',
  buildType: 'Container',
  protocol: 'HTTP',
  sdk: 'SpringAI',
  modelProvider: 'Bedrock',
  memory: 'none',
  language: 'Java',
};

describe('Java generation mapping', () => {
  it('omits EPISODIC from longAndShortTerm for a Java agent', () => {
    const result = mapGenerateInputToMemories('longAndShortTerm', 'MyProject', 'Java');
    expect(result[0]!.strategies.map(s => s.type)).toEqual(['SEMANTIC', 'USER_PREFERENCE', 'SUMMARIZATION']);
  });

  it('emits the container placeholder without runtimeVersion or tool connections', () => {
    const result = mapGenerateConfigToAgent(javaConfig);
    expect(result.build).toBe('Container');
    expect(result.entrypoint).toBe('main.py');
    expect(result.runtimeVersion).toBeUndefined();
    expect(result.instrumentation).toEqual({ enableOtel: false });
    expect(result.connections).toBeUndefined();
  });

  it('passes an explicit Java system prompt to the renderer', async () => {
    const result = await mapGenerateConfigToRenderConfig(
      { ...javaConfig, systemPrompt: 'You are a travel planner.' },
      []
    );
    expect(result).toMatchObject({
      targetLanguage: 'Java',
      sdkFramework: 'SpringAI',
      modelProvider: 'Bedrock',
      systemPrompt: 'You are a travel planner.',
    });
  });
});
