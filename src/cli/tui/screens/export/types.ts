import type { SDKFramework, TargetLanguage } from '../../../../schema';

export type ExportHarnessStep = 'select-harness' | 'target-name' | 'language' | 'build-type' | 'confirm';

export interface ExportHarnessConfig {
  harness: string;
  targetAgentName: string;
  /** Export supports Python (Strands) and Java (Spring AI). */
  language: TargetLanguage;
  /** Derived from language: Python → Strands, Java → SpringAI. */
  framework: SDKFramework;
  build: 'CodeZip' | 'Container';
}

export const EXPORT_HARNESS_STEP_LABELS: Record<ExportHarnessStep, string> = {
  'select-harness': 'Select harness',
  'target-name': 'Agent name',
  language: 'Language',
  'build-type': 'Build type',
  confirm: 'Confirm',
};
