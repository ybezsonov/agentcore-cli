/**
 * Shared Server-Sent Events (SSE) consumer for AgentCore runtime responses.
 *
 * Single source of truth for parsing the streaming/JSON responses that both the deployed-invoke
 * path (aws/agentcore.ts, commands/invoke) and the local dev-invoke path (operations/dev) consume.
 * Previously duplicated in both (see review/6-rfc-open-questions.md Q2); the two copies had drifted
 * (the dev copy handled the `{"text":...}` runtime frame; the aws copy unquoted bare JSON strings) —
 * this module unifies them to the superset behavior.
 */

/**
 * Parse a single SSE data line and extract the content.
 * Returns null content for non-data lines; sets `error` for `{"error": ...}` frames.
 */
export function parseSSELine(line: string): { content: string | null; error: string | null } {
  if (!line.startsWith('data:')) {
    return { content: null, error: null };
  }
  // Keep everything after "data:" WITHOUT stripping the SSE cosmetic leading space. Spring/Java
  // agents stream raw text chunks whose leading space is a significant word separator (" will"); a
  // spec-strict strip (slice(6)) both eats that space (rendering "Iwill") and — combined with the
  // old `data: ` guard — drops chunks that have no leading space. JSON-framed producers (Python/TS
  // ConverseStream, {"text":...}) are unaffected because JSON.parse ignores the leading whitespace.
  // Mirrors the java-on-aws chat UI's substring(5) reconstruction.
  const raw = line.slice(5);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return { content: parsed, error: null };
    }
    if (parsed && typeof parsed === 'object') {
      if ('error' in parsed) {
        return { content: null, error: String((parsed as { error: unknown }).error) };
      }
      // {"text": "..."} frame from the bedrock-agentcore runtime
      if ('text' in parsed) {
        return { content: String((parsed as { text: unknown }).text), error: null };
      }
    }
    // ConverseStream-shaped event: extract text delta
    const event = (parsed as { event?: { contentBlockDelta?: { delta?: { text?: string } } } })?.event;
    const text = event?.contentBlockDelta?.delta?.text;
    if (typeof text === 'string') {
      return { content: text, error: null };
    }
  } catch {
    return { content: raw, error: null };
  }
  return { content: null, error: null };
}

/**
 * Parse SSE-formatted text into combined content.
 * SSE format: "data: content\n\ndata: more content\n\n". Stops and returns the message on error.
 */
export function parseSSE(text: string): string {
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    const { content, error } = parseSSELine(line);
    if (error) {
      return `Error: ${error}`;
    }
    if (content) {
      parts.push(content);
    }
  }
  return parts.join('');
}

/**
 * True when a runtime response is SSE (streaming) rather than a plain JSON envelope, so the caller
 * runs parseSSE instead of extractResult.
 *
 * Tests for `data:` WITHOUT a trailing space: Spring/Java runtimes emit spec-compliant SSE with no
 * cosmetic space (`data:<token>`), matching parseSSELine's slice(5) contract. Requiring `data: `
 * made responses whose tokens never start with a space (e.g. a fenced code block) skip parseSSE and
 * fall to extractResult, whose JSON.parse throws on SSE and returns the raw `data:`-prefixed frames.
 */
export function isSSEResponse(text: string): boolean {
  return text.includes('data:');
}

/**
 * Extract result from a JSON response object.
 * Handles both {"result": "..."} and plain text responses; a bare JSON string is returned unquoted.
 */
export function extractResult(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'result' in parsed) {
      const result = (parsed as { result: unknown }).result;
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}
