import { createE2ESuite } from './e2e-helper.js';
import { expect } from 'vitest';

createE2ESuite({
  framework: 'SpringAI',
  modelProvider: 'Bedrock',
  build: 'Container',
  language: 'Java',
  invokePrompt: 'What is 6 times 7? Reply with only the number.',
  invokeResponseCheck: response => {
    expect(response).not.toMatch(/^Error:/);
    expect(response).toContain('42');
  },
});
