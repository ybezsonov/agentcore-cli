import { extractResult, isSSEResponse, parseSSE, parseSSELine } from '../sse.js';
import { describe, expect, it } from 'vitest';

describe('SSE parsing', () => {
  it('does not classify a Python JSON envelope containing a data URI as SSE', () => {
    const body = JSON.stringify({ result: 'Here is data:image/png;base64,abc' });
    expect(isSSEResponse(body)).toBe(false);
    expect(extractResult(body)).toBe('Here is data:image/png;base64,abc');
  });

  it('preserves newlines within one multi-line Java event', () => {
    expect(parseSSE('data:```\ndata:x=1\ndata:```\n\n')).toBe('```\nx=1\n```');
  });

  it('strips exactly one optional leading space from plain-text data fields', () => {
    expect(parseSSELine('data: hello').content).toBe('hello');
    expect(parseSSELine('data:  hello').content).toBe(' hello');
    expect(parseSSE('data:  hello\n\n')).toBe(' hello');
    expect(parseSSE('data: hello\ndata: world\n\n')).toBe('hello\nworld');
  });

  it('keeps non-string JSON payloads as raw text', () => {
    expect(parseSSE('data:42\n\n')).toBe('42');
  });

  it('returns error frames', () => {
    expect(parseSSE('data:{"error":"fail"}\n\n')).toBe('Error: fail');
  });

  it('handles empty and non-SSE input', () => {
    expect(isSSEResponse('')).toBe(false);
    expect(parseSSE('')).toBe('');
    expect(parseSSE('plain text')).toBe('plain text');
  });

  it('handles JSON strings, text objects, and ConverseStream deltas', () => {
    expect(parseSSELine('data:" hello"').content).toBe(' hello');
    expect(parseSSELine('data:{"text":"world"}').content).toBe('world');
    expect(parseSSELine('data:{"event":{"contentBlockDelta":{"delta":{"text":" token"}}}}').content).toBe(' token');
  });

  it('concatenates separate events without adding separators', () => {
    expect(parseSSE('data:"a"\n\ndata:"b"\n\n')).toBe('ab');
  });
});
