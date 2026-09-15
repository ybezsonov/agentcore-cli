import {
  DEFAULT_ENTRYPOINT_BY_LANGUAGE,
  LANGUAGE_FRAMEWORK_MATRIX,
  PROTOCOL_FRAMEWORK_MATRIX,
  RuntimeVersionSchema,
  SDKFrameworkSchema,
  TargetLanguageSchema,
  getFrameworksForLanguage,
  getSupportedFrameworksForProtocol,
  getSupportedModelProviders,
  isFrameworkSupportedForLanguage,
  isFrameworkSupportedForProtocol,
  isModelProviderSupported,
  matchEnumValue,
} from '../constants.js';
import { describe, expect, it } from 'vitest';

describe('Java and SpringAI constants', () => {
  it('accept Java and SpringAI with canonical casing and match them case-insensitively', () => {
    expect(TargetLanguageSchema.safeParse('Java').success).toBe(true);
    expect(TargetLanguageSchema.safeParse('java').success).toBe(false);
    expect(SDKFrameworkSchema.safeParse('SpringAI').success).toBe(true);
    expect(matchEnumValue(TargetLanguageSchema, 'java')).toBe('Java');
    expect(matchEnumValue(SDKFrameworkSchema, 'springai')).toBe('SpringAI');
  });

  it('have no Java runtime version and use the CDK-compatible placeholder entrypoint', () => {
    expect(RuntimeVersionSchema.safeParse('JAVA_21').success).toBe(false);
    expect(DEFAULT_ENTRYPOINT_BY_LANGUAGE.Java).toBe('main.py');
  });

  it('support only Bedrock for SpringAI', () => {
    expect(getSupportedModelProviders('SpringAI')).toEqual(['Bedrock']);
    expect(isModelProviderSupported('SpringAI', 'Bedrock')).toBe(true);
    expect(isModelProviderSupported('SpringAI', 'OpenAI')).toBe(false);
  });

  it('support SpringAI only over HTTP', () => {
    expect(PROTOCOL_FRAMEWORK_MATRIX.HTTP).toContain('SpringAI');
    expect(PROTOCOL_FRAMEWORK_MATRIX.A2A).not.toContain('SpringAI');
    expect(getSupportedFrameworksForProtocol('HTTP')).toContain('SpringAI');
    expect(isFrameworkSupportedForProtocol('HTTP', 'SpringAI')).toBe(true);
    expect(isFrameworkSupportedForProtocol('A2A', 'SpringAI')).toBe(false);
  });

  it('pair SpringAI only with Java', () => {
    expect(LANGUAGE_FRAMEWORK_MATRIX.Java).toEqual(['SpringAI']);
    expect(getFrameworksForLanguage('Java')).toEqual(['SpringAI']);
    expect(isFrameworkSupportedForLanguage('Java', 'SpringAI')).toBe(true);
    expect(isFrameworkSupportedForLanguage('Java', 'Strands')).toBe(false);
    expect(isFrameworkSupportedForLanguage('Python', 'SpringAI')).toBe(false);
  });
});
