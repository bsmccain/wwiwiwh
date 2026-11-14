import { describe, expect, it } from 'vitest';
import { AnswerTooLongError, readJsonWithin } from './read-json';

interface Chunked {
  readonly response: Response;
  /** How many pieces have been handed over so far. */
  sent(): number;
  cancelled(): boolean;
}

/** A body sent in pieces, by default with no Content-Length, the way a chunked answer arrives. */
function chunked(pieces: readonly string[], headers: HeadersInit = {}): Chunked {
  const encoder = new TextEncoder();
  let next = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const piece = pieces[next++];
        if (piece === undefined) controller.close();
        else controller.enqueue(encoder.encode(piece));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { headers }), sent: () => next, cancelled: () => cancelled };
}

describe('readJsonWithin', () => {
  it('reads an answer that fits, whole and in pieces', async () => {
    await expect(readJsonWithin(new Response('{"features":[1,2]}'), 100)).resolves.toEqual({ features: [1, 2] });
    await expect(readJsonWithin(chunked(['{"name":', '"São ', 'Paulo"}']).response, 100)).resolves.toEqual({ name: 'São Paulo' });
  });

  it('reads an answer of exactly the limit', async () => {
    const text = JSON.stringify({ pad: 'x'.repeat(90) });
    await expect(readJsonWithin(new Response(text), new TextEncoder().encode(text).byteLength)).resolves.toEqual({ pad: 'x'.repeat(90) });
  });

  it('refuses a chunked answer as soon as it is too long, and stops reading it', async () => {
    const piece = '"0123456789",'.repeat(10);
    const answer = chunked(['[', piece, piece, piece, piece, '"never read"]']);
    expect(answer.response.headers.get('content-length')).toBeNull();
    await expect(readJsonWithin(answer.response, 200)).rejects.toBeInstanceOf(AnswerTooLongError);
    // 1 + 130 + 130 bytes is past 200: the third piece is the last one asked for.
    expect(answer.sent()).toBe(3);
    expect(answer.cancelled()).toBe(true);
  });

  it('refuses an answer whose declared length is too long before reading any of it', async () => {
    const response = new Response('{}', { headers: { 'content-length': '5000' } });
    await expect(readJsonWithin(response, 100)).rejects.toBeInstanceOf(AnswerTooLongError);
  });

  it('does not take a short declared length at its word', async () => {
    const answer = chunked(['"', 'x'.repeat(500), '"'], { 'content-length': '10' });
    await expect(readJsonWithin(answer.response, 100)).rejects.toBeInstanceOf(AnswerTooLongError);
  });

  it('refuses what is not JSON', async () => {
    await expect(readJsonWithin(new Response('<html>Bad gateway</html>'), 100)).rejects.toBeInstanceOf(SyntaxError);
    await expect(readJsonWithin(new Response(null), 100)).rejects.toBeInstanceOf(SyntaxError);
  });
});
