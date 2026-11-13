import { describe, expect, it } from 'vitest';
import { fitSheet, placePopover, visibleBand, type Band } from './picker-layout';

const whole = (height: number): Band => ({ top: 0, bottom: height });

describe('visibleBand', () => {
  it('is the whole layout viewport when the browser reports no visual viewport', () => {
    expect(visibleBand(844, null)).toEqual({ top: 0, bottom: 844 });
  });

  it('ends where an on-screen keyboard begins', () => {
    expect(visibleBand(844, { offsetTop: 0, height: 508, scale: 1 })).toEqual({ top: 0, bottom: 508 });
  });

  it('follows the page when iOS pushes it up under the keyboard', () => {
    expect(visibleBand(844, { offsetTop: 120, height: 508, scale: 1 })).toEqual({ top: 120, bottom: 628 });
  });

  it('never reaches outside the layout viewport', () => {
    expect(visibleBand(844, { offsetTop: -20, height: 900, scale: 1 })).toEqual({ top: 0, bottom: 844 });
    expect(visibleBand(844, { offsetTop: 900, height: 300, scale: 1 })).toEqual({ top: 844, bottom: 844 });
  });

  it('ignores a visual viewport made small by pinch-zooming the page', () => {
    expect(visibleBand(844, { offsetTop: 200, height: 422, scale: 2 })).toEqual({ top: 0, bottom: 844 });
  });
});

describe('fitSheet', () => {
  it('takes 85% of the height when nothing is covered', () => {
    expect(fitSheet(844, whole(844))).toEqual({ lift: 0, height: 844 * 0.85 });
  });

  it('rises above the keyboard and keeps a margin at the top', () => {
    expect(fitSheet(844, { top: 0, bottom: 508 })).toEqual({ lift: 336, height: 496 });
  });

  it('stays inside the band when the page has been pushed up', () => {
    const fit = fitSheet(844, { top: 120, bottom: 628 });
    expect(fit).toEqual({ lift: 216, height: 496 });
    expect(844 - fit.lift - fit.height).toBe(132);
  });

  it('fits what a phone on its side leaves above its keyboard', () => {
    expect(fitSheet(390, { top: 0, bottom: 170 })).toEqual({ lift: 220, height: 158 });
  });

  it('has no height, not a negative one, when nothing can be seen', () => {
    expect(fitSheet(390, { top: 0, bottom: 8 }).height).toBe(0);
  });
});

describe('placePopover', () => {
  const desktop = { anchorLeft: 16, edgeTop: 808, edgeBottom: 900, screenWidth: 1440, band: whole(900) };

  it('rises above the edge, lined up with the anchor', () => {
    expect(placePopover(desktop)).toEqual({ left: 16, width: 360, height: 560, top: 240 });
  });

  it('is only as tall as the room above the edge', () => {
    const box = placePopover({ ...desktop, edgeTop: 408, edgeBottom: 500, band: whole(500) });
    expect(box).toMatchObject({ top: 12, height: 388 });
  });

  it('drops below an edge that has too little room above it', () => {
    const box = placePopover({ ...desktop, edgeTop: 0, edgeBottom: 92 });
    expect(box).toMatchObject({ top: 100, height: 560 });
  });

  it('prefers the larger side when neither has the minimum height', () => {
    const box = placePopover({ ...desktop, edgeTop: 200, edgeBottom: 292, band: whole(540) });
    expect(box).toMatchObject({ top: 300, height: 228 });
  });

  it('stays on screen at the right-hand edge and on a narrow screen', () => {
    expect(placePopover({ ...desktop, anchorLeft: 1300 }).left).toBe(1440 - 360 - 12);
    expect(placePopover({ ...desktop, screenWidth: 320 })).toMatchObject({ left: 12, width: 296 });
  });

  it('sits on the keyboard when the keyboard covers the edge', () => {
    const tablet = { anchorLeft: 16, edgeTop: 1088, edgeBottom: 1180, screenWidth: 820, band: { top: 0, bottom: 780 } };
    expect(placePopover(tablet)).toMatchObject({ top: 208, height: 560 });
    const sideways = { ...tablet, edgeTop: 728, edgeBottom: 820, screenWidth: 1180, band: { top: 0, bottom: 420 } };
    expect(placePopover(sideways)).toMatchObject({ top: 12, height: 396 });
  });

  it('keeps clear of the top of a page pushed up by the keyboard', () => {
    const box = placePopover({ ...desktop, band: { top: 150, bottom: 600 } });
    expect(box).toMatchObject({ top: 162, height: 426 });
  });
});

describe('placePopover for a control that stands on its own', () => {
  /** The pin in the middle of the map of a 1440 by 900 window, whose margin begins at 762. */
  const pin = { anchorLeft: 700, alone: { anchorRight: 740, marginTop: 762 }, edgeTop: 361, edgeBottom: 401, screenWidth: 1440, band: whole(900) };
  const at = (edgeTop: number): typeof pin => ({ ...pin, edgeTop, edgeBottom: edgeTop + 40 });

  it('stands beside the control at its full height, where above and below are both too short for it', () => {
    expect(placePopover(pin)).toEqual({ left: 748, width: 360, height: 560, top: 12 });
    // The same control as part of a margin has the popover above it, cut to the room there.
    expect(placePopover({ anchorLeft: 700, edgeTop: 361, edgeBottom: 401, screenWidth: 1440, band: whole(900) })).toEqual({
      left: 700,
      width: 360,
      height: 341,
      top: 12,
    });
  });

  it('goes to the left where the right has no room', () => {
    const nearTheRightEdge = { ...pin, anchorLeft: 1100, alone: { ...pin.alone, anchorRight: 1140 } };
    expect(placePopover(nearTheRightEdge)).toMatchObject({ left: 1100 - 8 - 360, top: 12, height: 560 });
  });

  it('stands beside a control in the lower half of the map too, clear of the margin', () => {
    const box = placePopover(at(480));
    expect(box).toMatchObject({ left: 748, height: 560 });
    expect(box.top + box.height).toBeLessThanOrEqual(762 - 8);
  });

  it('rises from the foot of the control where the screen is tall enough for that', () => {
    const box = placePopover({ ...at(560), alone: { anchorRight: 740, marginTop: 1262 }, band: whole(1400) });
    expect(box).toMatchObject({ left: 748, height: 560 });
    expect(box.top + box.height).toBe(600);
  });

  it('keeps above the margin on a short screen, where dropping below the control would cover it', () => {
    const short = { ...at(171), alone: { anchorRight: 740, marginTop: 382 }, band: whole(520) };
    expect(placePopover(short)).toEqual({ left: 748, width: 360, height: 362, top: 12 });
    // On a page without a margin the bottom of the screen is the limit.
    expect(placePopover({ ...short, alone: { anchorRight: 740, marginTop: null } })).toMatchObject({ top: 12, height: 496 });
  });

  it('rises above or drops below the control as ever where beside it would be no taller', () => {
    expect(placePopover(at(620))).toEqual({ left: 700, width: 360, height: 560, top: 52 });
    expect(placePopover(at(40))).toEqual({ left: 700, width: 360, height: 560, top: 88 });
  });

  it('does not drop below the control into the margin', () => {
    // 513 px between the control and the margin, 742 beside the control.
    expect(placePopover(at(193))).toEqual({ left: 748, width: 360, height: 560, top: 12 });
    // With no room on either side it drops below after all, and ends at the margin.
    const narrow = { ...at(193), anchorLeft: 360, alone: { anchorRight: 400, marginTop: 762 }, screenWidth: 760 };
    expect(placePopover(narrow)).toEqual({ left: 360, width: 360, height: 513, top: 241 });
  });

  it('rises above or drops below as ever where there is room on neither side', () => {
    expect(placePopover({ ...pin, anchorLeft: 360, alone: { ...pin.alone, anchorRight: 400 }, screenWidth: 760 })).toEqual({
      left: 360,
      width: 360,
      height: 341,
      top: 12,
    });
  });
});
