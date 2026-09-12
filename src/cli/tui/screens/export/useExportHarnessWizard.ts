import type { TargetLanguage } from '../../../../schema';
import type { ExportHarnessConfig, ExportHarnessStep } from './types';
import { useCallback, useMemo, useState } from 'react';

function defaultTargetName(harness: string): string {
  return `${harness}Agent`;
}

/** Export supports Python (Strands) and Java (Spring AI); the framework follows the language. */
function frameworkForLanguage(language: TargetLanguage): ExportHarnessConfig['framework'] {
  return language === 'Java' ? 'SpringAI' : 'Strands';
}

export function useExportHarnessWizard(harnessNames: string[], onExit: () => void) {
  const initialHarness = harnessNames[0] ?? '';
  const [step, setStep] = useState<ExportHarnessStep>(harnessNames.length <= 1 ? 'target-name' : 'select-harness');
  const [config, setConfig] = useState<ExportHarnessConfig>({
    harness: initialHarness,
    targetAgentName: defaultTargetName(initialHarness),
    language: 'Python',
    framework: 'Strands',
    build: 'CodeZip',
  });

  // Java is container-only, so its build type is forced to Container and the build-type step is skipped.
  const steps: ExportHarnessStep[] = useMemo(() => {
    const base: ExportHarnessStep[] =
      harnessNames.length <= 1
        ? ['target-name', 'language', 'build-type', 'confirm']
        : ['select-harness', 'target-name', 'language', 'build-type', 'confirm'];
    return config.language === 'Java' ? base.filter(s => s !== 'build-type') : base;
  }, [harnessNames.length, config.language]);

  const currentIndex = steps.indexOf(step);

  const goBack = useCallback(() => {
    const idx = steps.indexOf(step);
    if (idx <= 0) {
      onExit();
      return;
    }
    const prev = steps[idx - 1];
    if (prev) setStep(prev);
  }, [step, steps, onExit]);

  const setHarness = useCallback((harness: string) => {
    setConfig(c => ({
      ...c,
      harness,
      targetAgentName: defaultTargetName(harness),
    }));
    setStep('target-name');
  }, []);

  const setTargetAgentName = useCallback((targetAgentName: string) => {
    setConfig(c => ({ ...c, targetAgentName }));
    setStep('language');
  }, []);

  const setLanguage = useCallback((language: TargetLanguage) => {
    // Java is container-only: force Container and skip the build-type step.
    setConfig(c => ({
      ...c,
      language,
      framework: frameworkForLanguage(language),
      build: language === 'Java' ? 'Container' : c.build,
    }));
    setStep(language === 'Java' ? 'confirm' : 'build-type');
  }, []);

  const setBuild = useCallback((build: 'CodeZip' | 'Container') => {
    setConfig(c => ({ ...c, build }));
    setStep('confirm');
  }, []);

  return {
    config,
    step,
    steps,
    currentIndex,
    goBack,
    setHarness,
    setTargetAgentName,
    setLanguage,
    setBuild,
  };
}
