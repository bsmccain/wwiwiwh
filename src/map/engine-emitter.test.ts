import { describe, expect, it } from 'vitest';
import { createEmitter } from './engine-emitter';

interface Events {
  frame: undefined;
  count: number;
}

describe('createEmitter', () => {
  it('delivers events to listeners of that type, in subscription order', () => {
    const emitter = createEmitter<Events>();
    const seen: string[] = [];
    emitter.on('count', (n) => seen.push(`a${n}`));
    emitter.on('count', (n) => seen.push(`b${n}`));
    emitter.on('frame', () => seen.push('frame'));
    emitter.emit('count', 1);
    emitter.emit('frame', undefined);
    expect(seen).toEqual(['a1', 'b1', 'frame']);
  });

  it('stops delivering after unsubscribing', () => {
    const emitter = createEmitter<Events>();
    const seen: number[] = [];
    const off = emitter.on('count', (n) => seen.push(n));
    emitter.emit('count', 1);
    off();
    emitter.emit('count', 2);
    expect(seen).toEqual([1]);
  });

  it('lets a listener unsubscribe another one mid-delivery', () => {
    const emitter = createEmitter<Events>();
    const seen: string[] = [];
    let offSecond: () => void = () => {};
    emitter.on('frame', () => {
      seen.push('first');
      offSecond();
    });
    offSecond = emitter.on('frame', () => seen.push('second'));
    emitter.emit('frame', undefined);
    expect(seen).toEqual(['first']);
  });

  it('delivers to every listener and carries on when one of them throws, handing the error on', () => {
    const surfaced: unknown[] = [];
    const emitter = createEmitter<Events>((error) => surfaced.push(error));
    const seen: string[] = [];
    const failure = new Error('listener');
    emitter.on('count', (n) => seen.push(`a${n}`));
    emitter.on('count', () => {
      throw failure;
    });
    emitter.on('count', (n) => seen.push(`c${n}`));
    expect(() => emitter.emit('count', 1)).not.toThrow();
    expect(seen).toEqual(['a1', 'c1']);
    expect(surfaced).toEqual([failure]);
    // The listener that threw is still subscribed: one bad delivery does not silence it.
    emitter.emit('count', 2);
    expect(seen).toEqual(['a1', 'c1', 'a2', 'c2']);
    expect(surfaced).toHaveLength(2);
  });

  it('clears every listener', () => {
    const emitter = createEmitter<Events>();
    let calls = 0;
    emitter.on('frame', () => calls++);
    emitter.clear();
    emitter.emit('frame', undefined);
    expect(calls).toBe(0);
  });
});
