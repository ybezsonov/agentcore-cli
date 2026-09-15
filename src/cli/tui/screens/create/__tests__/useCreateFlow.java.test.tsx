import type { AddAgentConfig } from '../../agent/types';
import { useCreateFlow } from '../useCreateFlow';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React, { act, useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FlowReturn = ReturnType<typeof useCreateFlow>;

const Harness = React.forwardRef<{ flow: FlowReturn }, { cwd: string }>(({ cwd }, ref) => {
  const flow = useCreateFlow(cwd);
  useImperativeHandle(ref, () => ({ flow }));
  return <Text>phase:{flow.phase}</Text>;
});
Harness.displayName = 'Harness';

describe('useCreateFlow — Java language matrix', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'create-flow-java-'));
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('rejects a Java CodeZip agent before writing the project directory', async () => {
    const ref = React.createRef<{ flow: FlowReturn }>();
    render(<Harness ref={ref} cwd={cwd} />);
    const flow = () => ref.current!.flow;
    await vi.waitFor(() => expect(flow().phase).toBe('input'));

    act(() => flow().setProjectName('LateMatrix'));
    act(() => flow().confirmProjectName());
    act(() => flow().handleCreateTypeSelection('agent'));
    act(() =>
      flow().handleAddAgentComplete({
        name: 'JavaAgent',
        agentType: 'create',
        codeLocation: 'app/JavaAgent/',
        entrypoint: 'main.py',
        language: 'Java',
        buildType: 'CodeZip',
        protocol: 'HTTP',
        framework: 'SpringAI',
        modelProvider: 'Bedrock',
        pythonVersion: 'PYTHON_3_13',
        memory: 'none',
      } as AddAgentConfig)
    );

    await vi.waitFor(() => expect(flow().hasError).toBe(true));
    expect(flow().steps[0]!.error).toBe(
      '--build CodeZip is not supported for Java agents. Use --build Container or omit --build.'
    );
    expect(existsSync(join(cwd, 'LateMatrix'))).toBe(false);
  });
});
