import { describe, expect, it } from 'vitest';
import type { Span } from '../app/readout';
import { CAPTION_COPY, captionFor, type CaptionInput, type DriveCaption } from './caption-model';

const trip: Span[] = [{ text: 'Palo Alto to San Jose', ink: 'home' }, { text: ' is 16.7 mi.' }];
const pin: Span[] = [{ text: 'Downtown San Jose', ink: 'home' }, { text: ' sits on ' }, { text: 'central London', ink: 'away' }];

const wide: CaptionInput = {
  mode: 'browse',
  tripStarted: false,
  slidSinceModeOn: false,
  drift: null,
  trip,
  driveOn: { sheet: 'home', place: 'San Jose' },
  driveStarted: false,
  drive: null,
  pin,
  turned: false,
  collarIsFull: true,
  pinInCollar: true,
  input: 'mouse',
  singleKeys: true,
};
const phone: CaptionInput = { ...wide, collarIsFull: false, pinInCollar: false, input: 'touch' };
const zoomedOut = { percent: 4, pinOnStage: true };
const farFromPin = { percent: 5, pinOnStage: false };

const text = (input: CaptionInput): string =>
  captionFor(input)
    .spans.map((span) => span.text)
    .join('');
const actions = (input: CaptionInput): string[] => captionFor(input).buttons.map((button) => button.action);

describe('caption priority', () => {
  it('puts slide mode above everything', () => {
    const input: CaptionInput = { ...wide, mode: 'slide', drift: zoomedOut };
    expect(captionFor(input).kind).toBe('slide');
    expect(text(input)).toBe(CAPTION_COPY.slideMouse);
    expect(text({ ...input, input: 'touch' })).toBe(CAPTION_COPY.slideTouch);
  });

  it('warns about scale before describing the trip', () => {
    expect(captionFor({ ...wide, drift: zoomedOut }).kind).toBe('scale');
  });

  it('describes the trip and offers to drive it or clear it', () => {
    expect(captionFor(wide).spans).toBe(trip);
    expect(actions(wide)).toEqual(['drive-trip', 'clear-trip']);
  });

  it('without a trip, says where the pin is unless the collar already does', () => {
    expect(text({ ...wide, trip: null })).toBe(CAPTION_COPY.invitation);
    expect(captionFor({ ...phone, trip: null }).spans).toBe(pin);
    expect(captionFor({ ...phone, trip: null }).kind).toBe('pin');
    // A single-row collar too narrow for the pin sentence hands it to the caption as a phone does.
    expect(captionFor({ ...wide, pinInCollar: false, trip: null }).kind).toBe('pin');
  });

  it('falls back to the invitation until the pin can be named', () => {
    expect(captionFor({ ...phone, trip: null, pin: null }).kind).toBe('invitation');
  });
});

describe('caption tone', () => {
  it('is loud for modes and warnings, so they cannot be missed', () => {
    expect(captionFor({ ...wide, mode: 'slide' }).tone).toBe('loud');
    expect(captionFor({ ...wide, mode: 'measure' }).tone).toBe('loud');
    expect(captionFor({ ...wide, drift: zoomedOut }).tone).toBe('loud');
    expect(captionFor({ ...wide, drift: farFromPin }).tone).toBe('loud');
  });

  it('is quiet for what is simply on the map', () => {
    expect(captionFor(wide).tone).toBe('quiet');
    expect(captionFor({ ...phone, trip: null }).tone).toBe('quiet');
    expect(captionFor({ ...wide, trip: null }).tone).toBe('quiet');
  });
});

describe('slide mode', () => {
  it('offers nudges, Square up and Done on the band where the collar is full', () => {
    expect(actions({ ...wide, mode: 'slide' })).toEqual(['slide-left', 'slide-up', 'slide-down', 'slide-right', 'square-up', 'done']);
  });

  it('keeps Square up in place but disabled until Home is turned', () => {
    const squareUp = (turned: boolean) => captionFor({ ...wide, mode: 'slide', turned }).buttons.find((button) => button.action === 'square-up');
    expect(squareUp(false)?.disabled).toBe(true);
    expect(squareUp(true)?.disabled).toBe(false);
  });

  it('leaves the buttons to the collar row on narrow screens, apart from Square up once Home is turned', () => {
    expect(actions({ ...phone, mode: 'slide' })).toEqual([]);
    expect(actions({ ...phone, mode: 'slide', turned: true })).toEqual(['square-up']);
  });

  it('says where the pin sits once Home has been slid or turned', () => {
    const sliding: CaptionInput = { ...phone, mode: 'slide' };
    expect(text(sliding)).toBe(CAPTION_COPY.slideTouch);
    expect(captionFor({ ...sliding, slidSinceModeOn: true }).spans).toBe(pin);
    expect(captionFor({ ...sliding, slidSinceModeOn: true }).tone).toBe('loud');
    // Nothing to say about the pin yet: the instruction stays.
    expect(text({ ...sliding, slidSinceModeOn: true, pin: null })).toBe(CAPTION_COPY.slideTouch);
  });

  it('tells keyboard users which keys slide and turn Home', () => {
    expect(text({ ...wide, mode: 'slide', input: 'keyboard' })).toBe('Sliding Home. Shift and the arrow keys slide it; [ and ] turn it.');
    expect(text({ ...wide, mode: 'slide', input: 'keyboard', singleKeys: false })).toBe(
      'Sliding Home. Shift and the arrow keys slide it; Shift with [ or ] turns it.',
    );
  });
});

describe('measure mode', () => {
  const measuring: CaptionInput = { ...wide, mode: 'measure', drift: zoomedOut };

  it('prompts for each end in the words of the pointer in use', () => {
    expect(text(measuring)).toBe('Click where the trip starts.');
    expect(text({ ...measuring, tripStarted: true })).toBe('Now click where it ends.');
    expect(text({ ...measuring, input: 'touch' })).toBe('Tap where the trip starts.');
    expect(text({ ...measuring, input: 'touch', tripStarted: true })).toBe('Now tap where it ends.');
  });

  it('offers an address in place of a press on the map, at both steps', () => {
    expect(actions(measuring)).toEqual(['to-address', 'cancel']);
    expect(actions({ ...measuring, tripStarted: true })).toEqual(['to-address', 'cancel']);
    expect(actions({ ...measuring, ...phone, mode: 'measure', input: 'keyboard' })).toEqual(['to-address', 'cancel']);
  });

  it('prompts for Enter at the centre mark while the keyboard is in use', () => {
    expect(text({ ...measuring, input: 'keyboard' })).toBe('Press Enter to set the start at the centre mark.');
    expect(text({ ...measuring, input: 'keyboard', tripStarted: true })).toBe('Move the map, then press Enter to set the end.');
  });
});

describe('the spots of the pin sentence', () => {
  it('can be pressed wherever the band carries the pin sentence', () => {
    expect(captionFor({ ...phone, trip: null }).pinSentence).toBe(true);
    expect(captionFor({ ...phone, mode: 'slide', slidSinceModeOn: true }).pinSentence).toBe(true);
  });

  it('are not offered in any other sentence, whatever inks it is set in', () => {
    expect(captionFor(wide).pinSentence).toBe(false);
    expect(captionFor({ ...phone, mode: 'slide' }).pinSentence).toBe(false);
    expect(captionFor({ ...phone, mode: 'slide', slidSinceModeOn: true, pin: null }).pinSentence).toBe(false);
    expect(captionFor({ ...phone, mode: 'measure' }).pinSentence).toBe(false);
    expect(captionFor({ ...phone, drift: zoomedOut }).pinSentence).toBe(false);
    expect(captionFor({ ...wide, trip: null }).pinSentence).toBe(false);
  });
});

describe('scale warning', () => {
  it('advises zooming in while the pin is in view', () => {
    const input: CaptionInput = { ...wide, drift: zoomedOut };
    expect(text(input)).toBe('Zoom in to compare. This far out the two maps stretch differently.');
    expect(actions(input)).toEqual([]);
  });

  it('names the distance from the pin as the cause when the pin is out of view, and offers to move it', () => {
    const input: CaptionInput = { ...wide, drift: farFromPin };
    expect(text(input)).toBe('The two maps match at the pin. This far from it they differ by about 5%.');
    expect(actions(input)).toEqual(['pin-here']);
  });
});

describe('setting a drive', () => {
  const driving: CaptionInput = { ...wide, mode: 'drive' };
  const pressed = (input: CaptionInput, action: string): boolean | undefined =>
    captionFor(input).buttons.find((button) => button.action === action)?.pressed;

  it('is loud, and comes before a warning about scale as the other modes do', () => {
    const caption = captionFor({ ...driving, drift: zoomedOut });
    expect(caption.kind).toBe('driving');
    expect(caption.tone).toBe('loud');
  });

  it('asks for the start and then the end, naming the place the drive is on in its ink', () => {
    expect(text(driving)).toBe('Click where the drive starts in San Jose.');
    expect(text({ ...driving, driveStarted: true })).toBe('Now click where it ends in San Jose.');
    expect(text({ ...driving, input: 'touch' })).toBe('Tap where the drive starts in San Jose.');
    expect(text({ ...driving, input: 'touch', driveStarted: true })).toBe('Now tap where it ends in San Jose.');
    const onAway: CaptionInput = { ...driving, driveOn: { sheet: 'away', place: 'London' } };
    expect(text(onAway)).toBe('Click where the drive starts in London.');
    expect(captionFor(driving).spans.find((span) => span.ink)).toEqual({ text: 'San Jose', ink: 'home' });
    expect(captionFor(onAway).spans.find((span) => span.ink)).toEqual({ text: 'London', ink: 'away' });
  });

  it('tells keyboard users about Enter and the centre mark', () => {
    expect(text({ ...driving, input: 'keyboard' })).toBe('Press Enter to set where the drive starts in San Jose, at the centre mark.');
    expect(text({ ...driving, input: 'keyboard', driveStarted: true })).toBe(CAPTION_COPY.driveKeysEnd);
  });

  it('offers the other place, an address, and the way out', () => {
    expect(actions(driving)).toEqual(['drive-on-away', 'to-address', 'cancel']);
    expect(pressed(driving, 'drive-on-away')).toBe(false);
    expect(pressed({ ...driving, driveOn: { sheet: 'away', place: 'London' } }, 'drive-on-away')).toBe(true);
  });

  it('settles the place with the start: the switch then only shows which it is', () => {
    const started = captionFor({ ...driving, driveStarted: true, driveOn: { sheet: 'away', place: 'London' } });
    expect(started.buttons[0]).toEqual({ action: 'drive-on-away', disabled: true, pressed: true });
  });
});

describe('a drive on the map', () => {
  const spans: Span[] = [{ text: 'Palo Alto to San Jose', ink: 'home' }, { text: ' is 17.4 mi by road.' }];
  const routed: DriveCaption = { spans, routed: true, byDistance: false, retry: false };
  const driven = (drive: Partial<DriveCaption> = {}): CaptionInput => ({ ...wide, trip: null, drive: { ...routed, ...drive } });

  it('is described quietly, in place of a trip and before the pin', () => {
    const caption = captionFor({ ...phone, trip, drive: routed });
    expect(caption.kind).toBe('drive');
    expect(caption.tone).toBe('quiet');
    expect(caption.spans).toBe(spans);
    expect(caption.pinSentence).toBe(false);
  });

  it('gives way to a mode and to a warning about scale', () => {
    expect(captionFor({ ...driven(), mode: 'slide' }).kind).toBe('slide');
    expect(captionFor({ ...driven(), mode: 'drive' }).kind).toBe('driving');
    expect(captionFor({ ...driven(), drift: zoomedOut }).kind).toBe('scale');
  });

  it('offers to match the distance in place of the time once there is a route, and to clear the drive', () => {
    expect(captionFor(driven()).buttons).toEqual([
      { action: 'same-distance', disabled: false, pressed: false },
      { action: 'clear-drive', disabled: false },
    ]);
    expect(captionFor(driven({ byDistance: true })).buttons[0]).toEqual({ action: 'same-distance', disabled: false, pressed: true });
  });

  it('has nothing to match while there is no route', () => {
    expect(actions(driven({ routed: false }))).toEqual(['clear-drive']);
  });

  it('offers to ask again when the road service failed, about the drive or about its reach', () => {
    expect(actions(driven({ routed: false, retry: true }))).toEqual(['retry-drive', 'clear-drive']);
    expect(actions(driven({ retry: true }))).toEqual(['same-distance', 'retry-drive', 'clear-drive']);
  });
});
