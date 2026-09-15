export interface ParsedSSELine {
  content: string | null;
  error: string | null;
}

export function isSSEResponse(text: string): boolean {
  return /^data:/m.test(text);
}

function dataFieldValue(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const raw = line.slice(5);
  return raw.startsWith(' ') ? raw.slice(1) : raw;
}

function parseDataValue(raw: string): ParsedSSELine {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string') return { content: parsed, error: null };
    if (parsed === null || typeof parsed !== 'object') return { content: String(parsed), error: null };
    if ('error' in parsed) return { content: null, error: String((parsed as { error: unknown }).error) };
    if ('text' in parsed && typeof (parsed as { text?: unknown }).text === 'string') {
      return { content: (parsed as { text: string }).text, error: null };
    }
    const event = (parsed as { event?: { contentBlockDelta?: { delta?: { text?: string } } } }).event;
    const text = event?.contentBlockDelta?.delta?.text;
    return typeof text === 'string' ? { content: text, error: null } : { content: null, error: null };
  } catch {
    return { content: raw, error: null };
  }
}

export function parseSSELine(line: string): ParsedSSELine {
  const raw = dataFieldValue(line);
  return raw === null ? { content: null, error: null } : parseDataValue(raw);
}

export function parseSSE(text: string): string {
  const parts: string[] = [];
  const events = text.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const event of events) {
    const data = event
      .split('\n')
      .map(dataFieldValue)
      .filter((value): value is string => value !== null);
    if (data.length === 0) continue;
    const { content, error } = parseDataValue(data.join('\n'));
    if (error) return `Error: ${error}`;
    if (content !== null) parts.push(content);
  }
  return parts.length > 0 ? parts.join('') : text;
}

export function extractResult(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'result' in parsed) {
      const result = (parsed as { result: unknown }).result;
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }
    if (parsed && typeof parsed === 'object' && 'text' in parsed) {
      const result = (parsed as { text: unknown }).text;
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}
