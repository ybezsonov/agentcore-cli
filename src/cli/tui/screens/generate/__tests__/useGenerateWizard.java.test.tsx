import { useGenerateWizard } from '../useGenerateWizard';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React, { act, useImperativeHandle } from 'react';
import { describe, expect, it } from 'vitest';

type WizardReturn = ReturnType<typeof useGenerateWizard>;

const Harness = React.forwardRef<{ wizard: WizardReturn }>((_props, ref) => {
  const wizard = useGenerateWizard({ initialName: 'JavaAgent' });
  useImperativeHandle(ref, () => ({ wizard }));
  return <Text>step:{wizard.step}</Text>;
});
Harness.displayName = 'Harness';

function setup() {
  const ref = React.createRef<{ wizard: WizardReturn }>();
  render(<Harness ref={ref} />);
  return () => ref.current!.wizard;
}

describe('useGenerateWizard — Java language', () => {
  it('keeps the Container build through the protocol, framework, and model steps', () => {
    const wizard = setup();
    act(() => wizard().setLanguage('Java'));
    expect(wizard().steps).not.toContain('buildType');
    act(() => wizard().setProtocol('HTTP'));
    act(() => wizard().setSdk('SpringAI'));
    act(() => wizard().setModelProvider('Bedrock'));

    expect(wizard().step).toBe('memory');
    expect(wizard().config).toMatchObject({
      language: 'Java',
      buildType: 'Container',
      protocol: 'HTTP',
      sdk: 'SpringAI',
      modelProvider: 'Bedrock',
    });
  });

  it('drops a config bundle and session storage chosen before switching to Java', () => {
    const wizard = setup();
    act(() => {
      wizard().setLanguage('Python');
      wizard().setAdvanced(['configBundle', 'filesystem']);
    });
    act(() => {
      wizard().setSessionStorageMountPath('/mnt/session');
    });
    expect(wizard().config.withConfigBundle).toBe(true);
    expect(wizard().config.sessionStorageMountPath).toBe('/mnt/session');

    act(() => wizard().setLanguage('Java'));

    expect(wizard().config.withConfigBundle).toBeUndefined();
    expect(wizard().config.sessionStorageMountPath).toBeUndefined();
    expect(wizard().config.sdk).toBe('SpringAI');
  });
});
