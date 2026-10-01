/**
 * Server-Sent Events parsing shared by `invoke`, `dev`, and the dev web UI, so that buffered and streaming
 * responses read the same way.
 *
 * Each `data` line is read as one agent payload (see {@link parseSSELine}); agents send one payload per line.
 * Lines may end in CRLF, LF, or CR, and the space after `data:` is optional.
 */

export interface ParsedSSELine {
  content: string | null;
  error: string | null;
}

/** Logs each raw SSE line, for `--verbose` and the dev log. */
export interface SSELineLogger {
  logSSEEvent(rawLine: string): void;
}

/** True when the body contains at least one SSE `data` line. */
export function isSSEResponse(text: string): boolean {
  return /^data:/m.test(text);
}

/**
 * Parse a single SSE line. A `data` line holds a JSON string, `{"text": …}`, `{"error": …}`, a ConverseStream
 * `contentBlockDelta`, or plain text. Only string text is content: other lines, JSON `null`, numbers, booleans,
 * a non-string `text`, and JSON objects of any other shape carry no content.
 */
export function parseSSELine(line: string): ParsedSSELine {
  if (!line.startsWith('data:')) return { content: null, error: null };
  const raw = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return { content: parsed, error: null };
    if (parsed === null || typeof parsed !== 'object') return { content: null, error: null };
    if ('error' in parsed) return { content: null, error: String((parsed as { error: unknown }).error) };
    const { text } = parsed as { text?: unknown };
    if (typeof text === 'string') return { content: text, error: null };
    const event = (parsed as { event?: { contentBlockDelta?: { delta?: { text?: unknown } } } }).event;
    const delta = event?.contentBlockDelta?.delta?.text;
    return typeof delta === 'string' ? { content: delta, error: null } : { content: null, error: null };
  } catch {
    return { content: raw, error: null };
  }
}

/** Splits SSE text into lines in any chunking, and parses each complete line. */
export class SSELineDecoder {
  private buffer = '';
  private afterCR = false;

  constructor(private readonly logger?: SSELineLogger) {}

  push(chunk: string): ParsedSSELine[] {
    let text = chunk;
    // A CR at the end of the previous chunk already ended a line; drop the LF of a split CRLF.
    if (this.afterCR && text.startsWith('\n')) text = text.slice(1);
    if (text) this.afterCR = text.endsWith('\r');
    const lines = (this.buffer + text).split(/\r\n|\r|\n/);
    this.buffer = lines.pop() ?? '';
    return lines.map(line => this.parse(line));
  }

  /** Parses the last line when the stream does not end with a line break. */
  flush(): ParsedSSELine[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest ? [this.parse(rest)] : [];
  }

  private parse(line: string): ParsedSSELine {
    if (line.trim()) this.logger?.logSSEEvent(line);
    return parseSSELine(line);
  }
}

/** Parse a complete SSE body into combined text. Returns `Error: <message>` on the first error line. */
export function parseSSE(text: string): string {
  const decoder = new SSELineDecoder();
  const parts: string[] = [];
  for (const { content, error } of [...decoder.push(text), ...decoder.flush()]) {
    if (error) return `Error: ${error}`;
    if (content) parts.push(content);
  }
  return parts.join('');
}

/**
 * Streams the text of a response body as it arrives and releases the reader when done. Stops after yielding
 * `Error: <message>` for an error line. A body with no `data` line is read as a plain JSON or text response.
 */
export async function* readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  logger?: SSELineLogger
): AsyncGenerator<string, void, unknown> {
  const textDecoder = new TextDecoder();
  const decoder = new SSELineDecoder(logger);
  let fullResponse = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      const decoded = done ? textDecoder.decode() : textDecoder.decode(value, { stream: true });
      fullResponse += decoded;
      const lines = done ? [...decoder.push(decoded), ...decoder.flush()] : decoder.push(decoded);
      for (const { content, error } of lines) {
        if (error) {
          yield `Error: ${error}`;
          return;
        }
        if (content) yield content;
      }
      if (done) break;
    }
    if (!isSSEResponse(fullResponse) && fullResponse.trim()) yield extractResult(fullResponse.trim());
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract result from a JSON response object.
 * Handles both {"result": "..."} and plain text responses.
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
