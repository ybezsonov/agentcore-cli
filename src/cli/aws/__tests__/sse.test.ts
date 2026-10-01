import { SSELineDecoder, extractResult, isSSEResponse, parseSSE, readSSEStream } from '../sse.js';
import { describe, expect, it } from 'vitest';

function readerOf(...chunks: (string | Uint8Array)[]): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  }).getReader();
}

async function collect(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const text of readSSEStream(reader)) out.push(text);
  return out;
}

describe('SSE parsing', () => {
  it('accepts data lines without the space after the colon', () => {
    expect(parseSSE('data:{"text":"Hello"}\n\ndata:{"text":" world"}\n\n')).toBe('Hello world');
  });

  it('reads {"text": ...} payloads', () => {
    expect(parseSSE('data: {"text": "hi"}\n\n')).toBe('hi');
  });

  it('splits lines on CRLF, LF, and CR', () => {
    expect(parseSSE('data: "a"\r\n\r\ndata: "b"\n\ndata: "c"\r\rdata: "d"')).toBe('abcd');
  });

  it('reads only string text as content', () => {
    expect(parseSSE('data: null\n\ndata: 7\n\ndata: true\n\ndata: {"text": 7}\n\ndata: "ok"\n\n')).toBe('ok');
  });

  it('prints a plain JSON string response unquoted and other JSON pretty-printed', () => {
    expect(extractResult('"hello"')).toBe('hello');
    expect(extractResult('{"result": "done"}')).toBe('done');
    expect(extractResult('{"a": 1}')).toBe('{\n  "a": 1\n}');
    expect(extractResult('not json')).toBe('not json');
  });

  it('returns no text for a body with only non-text events', () => {
    expect(parseSSE('data: {"event": {"messageStop": {"stopReason": "end_turn"}}}\n\n')).toBe('');
  });

  it('does not treat a data URI inside a plain response as SSE', () => {
    expect(isSSEResponse('Here is data:image/png;base64,abc')).toBe(false);
    expect(isSSEResponse('data: "x"')).toBe(true);
  });
});

describe('readSSEStream', () => {
  it('yields the same text as parseSSE for the same body', async () => {
    const body = 'data:hello\ndata:world\n\n';
    expect((await collect(readerOf(body))).join('')).toBe(parseSSE(body));
  });

  it('joins a line split across chunks, including a split CRLF and a split UTF-8 character', async () => {
    const bytes = new TextEncoder().encode('data: "café"\r\n\r\n');
    const cut = bytes.indexOf(0xc3) + 1;
    const crlf = bytes.indexOf(0x0d) + 1;
    const chunks = [bytes.slice(0, cut), bytes.slice(cut, crlf), bytes.slice(crlf)];
    expect(await collect(readerOf(...chunks))).toEqual(['café']);
  });

  it('parses a last line that has no line break', async () => {
    expect(await collect(readerOf('data: "a"\n\n', 'data: "b"'))).toEqual(['a', 'b']);
  });

  it('stops after an error line', async () => {
    expect(await collect(readerOf('data: "a"\n\ndata: {"error": "boom"}\n\ndata: "b"\n\n'))).toEqual([
      'a',
      'Error: boom',
    ]);
  });

  it('yields nothing for a stream with only non-text events', async () => {
    expect(await collect(readerOf('data: {"event": {"messageStop": {}}}\n\n'))).toEqual([]);
  });

  it('reads a body without data lines as a plain response', async () => {
    expect(await collect(readerOf('{"result": "done"}'))).toEqual(['done']);
  });

  it('logs each non-blank raw line', () => {
    const lines: string[] = [];
    const decoder = new SSELineDecoder({ logSSEEvent: line => lines.push(line) });
    decoder.push('event: message\ndata: "x"\n\n');
    expect(lines).toEqual(['event: message', 'data: "x"']);
  });
});
