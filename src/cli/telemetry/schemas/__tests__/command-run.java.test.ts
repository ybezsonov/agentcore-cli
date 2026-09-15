import { COMMAND_SCHEMAS } from '../command-run';
import { describe, expect, it } from 'vitest';

describe('COMMAND_SCHEMAS for Java', () => {
  it('accepts Java / SpringAI create attrs', () => {
    const attrs = {
      agent_environment: 'runtime',
      agent_language: 'java',
      agent_framework: 'springai',
      model_provider: 'bedrock',
      memory_type: 'longandshortterm',
      agent_protocol: 'http',
      build_type: 'container',
      agent_source: 'create',
      network_mode: 'public',
      has_agent: true,
    };
    expect(COMMAND_SCHEMAS.create.parse(attrs)).toEqual(attrs);
  });
});
