import { type ParsedSSELine, SSELineDecoder } from '../../aws/sse';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { StringDecoder } from 'node:string_decoder';

/**
 * Pipe an SSE stream from an agent response to a client response,
 * transforming each SSE event through parseSSELine so formats like
 * ConverseStream are normalized to plain text before reaching the browser.
 *
 * Non-text content (errors) is forwarded as `data: {"error": "..."}\n\n`.
 * Parsed text is forwarded as `data: "text"\n\n`.
 */
export function pipeSSETransformed(input: IncomingMessage, output: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const textDecoder = new StringDecoder('utf8');
    const decoder = new SSELineDecoder();
    const forward = (lines: ParsedSSELine[]) => {
      for (const { content, error } of lines) {
        if (error) {
          output.write(`data: ${JSON.stringify({ error })}\n\n`);
        } else if (content) {
          output.write(`data: ${JSON.stringify(content)}\n\n`);
        }
      }
    };

    input.on('data', (chunk: Buffer) => forward(decoder.push(textDecoder.write(chunk))));

    input.on('end', () => {
      forward([...decoder.push(textDecoder.end()), ...decoder.flush()]);
      output.end();
      resolve();
    });

    input.on('error', reject);
  });
}
