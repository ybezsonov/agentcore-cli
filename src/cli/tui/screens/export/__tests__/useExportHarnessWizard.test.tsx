import { useExportHarnessWizard } from '../useExportHarnessWizard';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React, { act, useImperativeHandle } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Imperative harness — exposes the wizard via ref for act()-based assertions.
type WizardReturn = ReturnType<typeof useExportHarnessWizard>;
interface HarnessHandle {
  wizard: WizardReturn;
}

const Harness = React.forwardRef<HarnessHandle, { harnessNames: string[] }>((props, ref) => {
  const wizard = useExportHarnessWizard(props.harnessNames, vi.fn());
  useImperativeHandle(ref, () => ({ wizard }));
  return (
    <Text>
      step:{wizard.step} steps:{wizard.steps.join(',')}
    </Text>
  );
});
Harness.displayName = 'Harness';

function setup(harnessNames: string[]) {
  const ref = React.createRef<HarnessHandle>();
  const result = render(<Harness ref={ref} harnessNames={harnessNames} />);
  return { ref, ...result };
}

describe('useExportHarnessWizard', () => {
  it('defaults to Python/Strands', () => {
    const { ref } = setup(['h1']);
    expect(ref.current!.wizard.config.language).toBe('Python');
    expect(ref.current!.wizard.config.framework).toBe('Strands');
  });

  it('inserts the language step after target-name (single harness)', () => {
    const { ref } = setup(['h1']);
    expect(ref.current!.wizard.steps).toEqual(['target-name', 'language', 'build-type', 'confirm']);
  });

  it('Java derives SpringAI, forces Container, and skips the build-type step', () => {
    const { ref } = setup(['h1']);
    act(() => {
      ref.current!.wizard.setTargetAgentName('MyAgent');
      ref.current!.wizard.setLanguage('Java');
    });
    expect(ref.current!.wizard.config.language).toBe('Java');
    expect(ref.current!.wizard.config.framework).toBe('SpringAI');
    expect(ref.current!.wizard.config.build).toBe('Container');
    expect(ref.current!.wizard.step).toBe('confirm');
    expect(ref.current!.wizard.steps).not.toContain('build-type');
  });

  it('Python keeps Strands and the build-type step', () => {
    const { ref } = setup(['h1']);
    act(() => {
      ref.current!.wizard.setTargetAgentName('MyAgent');
      ref.current!.wizard.setLanguage('Python');
    });
    expect(ref.current!.wizard.config.framework).toBe('Strands');
    expect(ref.current!.wizard.step).toBe('build-type');
    expect(ref.current!.wizard.steps).toContain('build-type');
  });
});
