import { turnWordsSpoken } from '../app/readout';
import { screenAngle } from '../geo/angles';
import type { ScreenBox, ScreenPoint } from '../map/contracts';
import { drawing, html, hugFocus, px, setAttribute, setTransform, svg } from './dom';
import { bindDrag } from './drag';
import { boxAround, distanceBetween, pointAtAngle, stepTurn, turnWhileDragging } from './geometry';
import type { Frame, InstrumentContext, Part } from './part';

/** Radius of the ring the knob rides on. The stylesheet takes it from here, as --mapz-turn-radius. */
const TURN_RADIUS = 44;
/** Closer to the pin than this, the pointer's direction swings too wildly to steer by. */
const STEADY_RADIUS_PX = 8;
const KEY_STEP_DEG = 1;
const KEY_BIG_STEP_DEG = 15;
/** How wide the knob's face is with the focus ring that hugs it. Place names keep clear of a square that size. */
const CLEARANCE_PX = 30;
/** How long the ring and knob outstay the pointer: long enough to cross from the pin to the knob. */
const LINGER_MS = 400;

interface Grab {
  readonly pivot: ScreenPoint;
  /** The screen angle about the pin at which the knob was grabbed. */
  readonly grabbedAt: number;
  readonly startRotation: number;
}

/** The thin ring about the pin, with a tick at each quarter turn, where the knob squares up. */
function turnRing(): SVGSVGElement {
  const reach = TURN_RADIUS + 16;
  const ticks = [0, 90, 180, 270].map((quarter) =>
    svg('path', { class: 'mapz-turn__tick', d: `M0 ${-TURN_RADIUS}V${-TURN_RADIUS + 5}`, transform: `rotate(${quarter})` }),
  );
  return drawing('mapz-turn__ring', { viewBox: `${-reach} ${-reach} ${2 * reach} ${2 * reach}`, width: 2 * reach, height: 2 * reach }, [
    svg('circle', { class: 'mapz-turn__casing', r: TURN_RADIUS }),
    svg('circle', { class: 'mapz-turn__line', r: TURN_RADIUS }),
    ...ticks,
  ]);
}

function keyTurn(event: KeyboardEvent, rotation: number): number | null {
  const step = event.shiftKey ? KEY_BIG_STEP_DEG : KEY_STEP_DEG;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return stepTurn(rotation, step);
    case 'ArrowLeft':
    case 'ArrowDown':
      return stepTurn(rotation, -step);
    case 'PageUp':
      return stepTurn(rotation, KEY_BIG_STEP_DEG);
    case 'PageDown':
      return stepTurn(rotation, -KEY_BIG_STEP_DEG);
    case 'Home':
      return 0;
    default:
      return null;
  }
}

export interface Knob extends Part {
  /**
   * Whether the turn ring and the knob are showing: throughout slide mode, while the pin or the knob
   * is hovered or focused, and while Home is being turned.
   */
  isUp(): boolean;
}

/**
 * The turn knob: a small handle on a ring about the pin, sitting where Home's north points. Dragging
 * it round the pin turns Home; to assistive tech it is a slider from -180 to 180 degrees.
 * `group` is the element that rides on the pin.
 */
export function createKnob({ dual, store, layer, relayout }: InstrumentContext, group: HTMLElement): Knob {
  const letter = html('span', 'mapz-knob__letter', { 'aria-hidden': 'true' });
  letter.textContent = 'N';
  const face = html('span', 'mapz-knob__face');
  face.append(letter);
  // The slider itself is always there for the keyboard and for assistive tech. What comes and goes
  // with the ring is the part that takes the pointer, so an unseen knob never swallows a click.
  const grip = html('span', 'mapz-knob__grip mapz-handle');
  grip.append(face);
  const knob = html('div', 'mapz-knob', {
    role: 'slider',
    tabindex: 0,
    'aria-label': 'Turn Home',
    'aria-valuemin': -180,
    'aria-valuemax': 180,
  });
  hugFocus(knob, CLEARANCE_PX);
  knob.append(grip);
  const arm = html('div', 'mapz-turn__arm');
  arm.append(knob);
  const turn = html('div', 'mapz-turn');
  turn.style.setProperty('--mapz-turn-radius', `${TURN_RADIUS}px`);
  turn.append(turnRing(), arm);
  group.append(turn);

  /** What keeps the ring and knob up, apart from slide mode. */
  const reasons = { hovered: false, focused: false, held: false, turningOnMap: false };
  let leaving: ReturnType<typeof setTimeout> | null = null;

  function setReason(reason: keyof typeof reasons, on: boolean): void {
    if (reasons[reason] === on) return;
    reasons[reason] = on;
    relayout();
  }

  const stopLeaving = (): void => {
    if (leaving !== null) clearTimeout(leaving);
    leaving = null;
  };

  const turnTo = (rotation: number, final: boolean): void => {
    dual.setRegistration({ ...dual.getRegistration(), rotation }, { final });
  };
  const squareUp = (): void => {
    if (dual.getRegistration().rotation !== 0) turnTo(0, true);
  };

  const unbindDrag = bindDrag<Grab>(grip, layer, {
    start: (point) => {
      const registration = dual.getRegistration();
      const pivot = dual.projectAway(registration.baseAnchor);
      setReason('held', true);
      return { pivot, grabbedAt: screenAngle(pivot, point), startRotation: registration.rotation };
    },
    move: (point, grab) => {
      if (distanceBetween(grab.pivot, point) < STEADY_RADIUS_PX) return;
      turnTo(turnWhileDragging(grab.startRotation, grab.grabbedAt, screenAngle(grab.pivot, point)), false);
    },
    end: ({ startRotation }, { moved, cancelled }) => {
      try {
        // One finished change closes a drag that turned Home, wherever it leaves it.
        if (moved) turnTo(cancelled ? startRotation : dual.getRegistration().rotation, true);
      } finally {
        setReason('held', false);
      }
    },
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const rotation = keyTurn(event, dual.getRegistration().rotation);
    if (rotation === null) return;
    event.preventDefault();
    event.stopPropagation();
    turnTo(rotation, true);
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  knob.addEventListener('keydown', onKeyDown, { signal });
  knob.addEventListener('dblclick', squareUp, { signal });
  group.addEventListener(
    'pointerenter',
    (event) => {
      // A finger does not hover: it would leave the knob up through any amount of panning afterwards.
      // There, a tap on the pin brings the knob up by focusing the pin.
      if (event.pointerType === 'touch') return;
      stopLeaving();
      setReason('hovered', true);
    },
    { signal },
  );
  group.addEventListener(
    'pointerleave',
    () => {
      if (!reasons.hovered || leaving !== null) return;
      leaving = setTimeout(() => {
        leaving = null;
        setReason('hovered', false);
      }, LINGER_MS);
    },
    { signal },
  );
  group.addEventListener('focusin', () => setReason('focused', true), { signal });
  group.addEventListener(
    'focusout',
    (event) => {
      // Still inside when focus moves between the pin and the knob, or when only the window lost focus.
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : document.activeElement;
      setReason('focused', group.contains(next));
    },
    { signal },
  );
  const offGesture = dual.on('gesture', ({ kind, phase }) => {
    if (kind === 'turn') setReason('turningOnMap', phase === 'start');
  });

  /** The picture as last laid out. */
  let pinAt: ScreenPoint = { x: 0, y: 0 };
  let drawnRotation: number | null = null;
  let up = false;

  return {
    isUp: () => store.get().mode === 'slide' || reasons.hovered || reasons.focused || reasons.held || reasons.turningOnMap,
    layout({ pin, registration, turnUp }: Frame) {
      const { rotation } = registration;
      pinAt = pin;
      up = turnUp;
      if (rotation === drawnRotation) return;
      drawnRotation = rotation;
      setTransform(arm, `rotate(${px(rotation)}deg)`);
      // The letter is turned back so it stays upright wherever the knob sits.
      setTransform(letter, `rotate(${px(-rotation)}deg)`);
      setAttribute(knob, 'aria-valuenow', String(Math.round(rotation)));
      setAttribute(knob, 'aria-valuetext', turnWordsSpoken(rotation));
    },
    reserved: (): readonly ScreenBox[] =>
      up ? [boxAround(pointAtAngle(pinAt, TURN_RADIUS, drawnRotation ?? 0), CLEARANCE_PX, CLEARANCE_PX)] : [],
    destroy() {
      unbindDrag();
      listeners.abort();
      offGesture();
      stopLeaving();
      turn.remove();
    },
  };
}
