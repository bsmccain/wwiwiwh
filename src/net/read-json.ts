/*
 * The public servers this app asks promise nothing, and a faulty or hostile one could answer with far
 * more than any real answer holds. Parsing and walking that answer runs on the page's only thread,
 * where no timeout can interrupt it, so an answer is measured while it arrives and dropped as soon as
 * it is longer than a real one could be.
 */

/** The answer was longer than the caller allows. */
export class AnswerTooLongError extends Error {
  constructor(maxBytes: number) {
    super(`The answer is longer than ${maxBytes} bytes`);
    this.name = 'AnswerTooLongError';
  }
}

/**
 * Reads a response body as JSON, refusing it once more than `maxBytes` of it have arrived. The count
 * is of the bytes as delivered, after the browser has undone any compression, so a missing or wrong
 * Content-Length changes nothing. Rejects with `AnswerTooLongError` for a body that is too long, with
 * a `SyntaxError` for one that is not JSON, and as the body stream does when the request is aborted.
 */
export async function readJsonWithin(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AnswerTooLongError(maxBytes);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError('The answer has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AnswerTooLongError(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
