import { describe, expect, it } from 'vitest';
import { composeAnnouncement } from './announcer';

type Channel = 'turn' | 'pin' | 'caption';
const CHANNELS: readonly Channel[] = ['turn', 'pin', 'caption'];
const map = (entries: Partial<Record<Channel, string>>): Map<Channel, string> => new Map(Object.entries(entries) as [Channel, string][]);

describe('what the announcer says', () => {
  it('says only what changed', () => {
    const spoken = map({ turn: 'Home is not turned.', pin: 'A sits on B.', caption: 'Trip.' });
    const waiting = map({ pin: 'C sits near D.', caption: 'Trip.' });
    expect(composeAnnouncement(CHANNELS, spoken, waiting)).toEqual(['C sits near D.']);
  });

  it('puts the turn first, then the pin, whatever order they arrived in', () => {
    const spoken = map({ turn: 'Home is not turned.', pin: 'A sits on B.', caption: 'Trip.' });
    const waiting = map({ caption: 'Trip, turned.', pin: 'A sits on B, turned.', turn: 'Home is turned 90 degrees clockwise.' });
    expect(composeAnnouncement(CHANNELS, spoken, waiting)).toEqual([
      'Home is turned 90 degrees clockwise.',
      'A sits on B, turned.',
      'Trip, turned.',
    ]);
  });

  it('says a line once when two channels carry it', () => {
    const spoken = map({ pin: 'A sits on B.', caption: 'A sits on B.' });
    const waiting = map({ pin: 'C sits near D.', caption: 'C sits near D.' });
    expect(composeAnnouncement(CHANNELS, spoken, waiting)).toEqual(['C sits near D.']);
  });

  it('leaves out a channel that something else is already speaking', () => {
    const spoken = map({ turn: 'Home is not turned.', pin: 'A sits on B.' });
    const waiting = map({ turn: 'Home is turned 5 degrees clockwise.', pin: 'A sits on B, turned.' });
    expect(composeAnnouncement(CHANNELS, spoken, waiting, (channel) => channel === 'turn')).toEqual(['A sits on B, turned.']);
  });

  it('has nothing to say about a channel that fell silent', () => {
    expect(composeAnnouncement(CHANNELS, map({ caption: 'Trip.' }), map({ caption: '' }))).toEqual([]);
  });
});
