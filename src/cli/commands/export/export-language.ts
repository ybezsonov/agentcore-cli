import { ValidationError } from '../../../lib/errors/types';
import { SDKFrameworkSchema, TargetLanguageSchema, matchEnumValue } from '../../../schema';
import { validateLanguageMatrix } from '../shared/validate-language-matrix';
import type { ExportLanguageConfig } from './types';

/** The language and framework pairs that harness export supports. Python/Strands is the default. */
export const EXPORT_LANGUAGE_CONFIGS = {
  Python: { targetLanguage: 'Python', sdkFramework: 'Strands' },
  Java: { targetLanguage: 'Java', sdkFramework: 'SpringAI' },
} as const satisfies Record<string, ExportLanguageConfig>;

/** Resolves the --language and --framework flags of `export harness`. */
export function resolveExportLanguageConfig(options: {
  language?: string;
  framework?: string;
}): { success: true; config: ExportLanguageConfig } | { success: false; error: ValidationError } {
  const language = options.language ? matchEnumValue(TargetLanguageSchema, options.language) : 'Python';
  if (language !== 'Python' && language !== 'Java') {
    return {
      success: false,
      error: new ValidationError(
        `Unsupported --language "${options.language}". Harness export supports: Python, Java.`
      ),
    };
  }
  const config = EXPORT_LANGUAGE_CONFIGS[language];

  const framework = options.framework && (matchEnumValue(SDKFrameworkSchema, options.framework) ?? options.framework);
  if (language === 'Java' && framework) {
    const matrix = validateLanguageMatrix({ language, framework });
    if (!matrix.valid) return { success: false, error: new ValidationError(matrix.error!) };
  }
  if (framework && framework !== config.sdkFramework) {
    return {
      success: false,
      error: new ValidationError(
        `Unsupported --framework "${options.framework}" for ${language}. Expected ${config.sdkFramework}.`
      ),
    };
  }
  return { success: true, config };
}
