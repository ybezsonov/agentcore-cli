import { resolveExportLanguageConfig } from '../export-language';
import { describe, expect, it } from 'vitest';

describe('resolveExportLanguageConfig', () => {
  it('rejects a non-SpringAI framework for Java with the create/add message', () => {
    const result = resolveExportLanguageConfig({ language: 'Java', framework: 'Strands' });
    expect(!result.success && result.error.message).toBe(
      'Framework Strands is not yet available for Java agents. Use --framework SpringAI.'
    );
  });

  it('rejects a language that export does not support', () => {
    const result = resolveExportLanguageConfig({ language: 'TypeScript' });
    expect(!result.success && result.error.message).toBe(
      'Unsupported --language "TypeScript". Harness export supports: Python, Java.'
    );
  });

  it('defaults Java to SpringAI and Python to Strands', () => {
    expect(resolveExportLanguageConfig({ language: 'java' })).toEqual({
      success: true,
      config: { targetLanguage: 'Java', sdkFramework: 'SpringAI' },
    });
    expect(resolveExportLanguageConfig({})).toEqual({
      success: true,
      config: { targetLanguage: 'Python', sdkFramework: 'Strands' },
    });
  });
});
