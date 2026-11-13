import { el } from './dom';

/** Quiet for this long before anything is spoken, so a drag or a held key is announced once, at its end. */
const SETTLE_MS = 700;
/** How long a spoken message stays in the region before it is taken out of the page again. */
const LINGER_MS = 1000;

export interface Announcer<Channel extends string> {
  /**
   * The latest wording on a channel. It is spoken once things have settled, and only if it differs
   * from what that channel last said. The first wording of a channel is taken as already known.
   */
  say(channel: Channel, text: string): void;
  /**
   * While anything holds it, nothing is spoken: a gesture is in progress, or a new place is still
   * being drawn. Each reason is held and let go by its own name.
   */
  hold(reason: string, held: boolean): void;
}

export interface AnnouncerOptions<Channel extends string> {
  /** Every channel, in the order their lines are spoken when several have changed at once. */
  readonly channels: readonly Channel[];
  /** True while something else is already speaking this channel's news (a focused slider reads out its own value). */
  readonly spokenElsewhere?: (channel: Channel) => boolean;
}

/**
 * Picks what to say from what is waiting: each changed channel's line, in channel order, with a
 * line that two channels share said once. Returns the lines and the channels they settle.
 */
export function composeAnnouncement<Channel extends string>(
  channels: readonly Channel[],
  spoken: ReadonlyMap<Channel, string>,
  waiting: ReadonlyMap<Channel, string>,
  spokenElsewhere: (channel: Channel) => boolean = () => false,
): string[] {
  const lines: string[] = [];
  for (const channel of channels) {
    const text = waiting.get(channel);
    if (text === undefined || text === '' || spoken.get(channel) === text) continue;
    if (spokenElsewhere(channel) || lines.includes(text)) continue;
    lines.push(text);
  }
  return lines;
}

/**
 * The shell's one polite live region. The texts on screen change many times a second while Home is
 * dragged; this region is only written when they have come to rest, and emptied again shortly
 * after, so that someone reading down the page does not meet the last message a second time.
 */
export function createAnnouncer<Channel extends string>(host: HTMLElement, options: AnnouncerOptions<Channel>): Announcer<Channel> {
  const region = el('div', 'visually-hidden', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  host.append(region);

  const spoken = new Map<Channel, string>();
  const waiting = new Map<Channel, string>();
  const holds = new Set<string>();
  let settling: ReturnType<typeof setTimeout> | null = null;
  let lingering: ReturnType<typeof setTimeout> | null = null;

  const speak = (): void => {
    settling = null;
    const lines = composeAnnouncement(options.channels, spoken, waiting, options.spokenElsewhere);
    for (const [channel, text] of waiting) spoken.set(channel, text);
    waiting.clear();
    if (lines.length === 0) return;
    region.textContent = lines.join(' ');
    if (lingering !== null) clearTimeout(lingering);
    lingering = setTimeout(() => {
      region.textContent = '';
    }, LINGER_MS);
  };

  const schedule = (): void => {
    if (settling !== null) clearTimeout(settling);
    settling = holds.size === 0 && waiting.size > 0 ? setTimeout(speak, SETTLE_MS) : null;
  };

  return {
    say(channel, text) {
      if (!spoken.has(channel)) {
        spoken.set(channel, text);
        return;
      }
      waiting.set(channel, text);
      schedule();
    },
    hold(reason, held) {
      if (held) holds.add(reason);
      else holds.delete(reason);
      schedule();
    },
  };
}
