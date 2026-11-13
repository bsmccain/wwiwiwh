import { describe, expect, it } from 'vitest';
import { MAX_MERCATOR_LAT } from '../geo/mercator';
import { baseToOverlay, overlayToBase } from '../geo/registration';
import { centeredRegistration, defaultLinkState, NO_SPOTS, presetPlace } from './defaults';
import type { LinkState, Place } from './types';
import { decodeLink, encodeLink } from './url';

const stanford: Place = { name: 'Stanford, the Farm', context: '', center: { lat: 37.4275, lng: -122.1697 } };

describe('link encoding', () => {
  it('keeps the default link short', () => {
    expect(encodeLink(defaultLinkState())).toBe('home=san-jose&away=london');
  });

  it('decodes an empty hash to the defaults without complaint', () => {
    for (const hash of ['', '#', '   ']) {
      const { state, incomplete } = decodeLink(hash);
      expect(incomplete).toBe(false);
      expect(state).toEqual(defaultLinkState());
    }
  });

  it('round-trips a fully customised view', () => {
    const away = presetPlace('paris') as Place;
    const state: LinkState = {
      home: stanford,
      away,
      reg: {
        overlayAnchor: { lat: 37.4419, lng: -122.143 },
        baseAnchor: { lat: 48.8049, lng: 2.1204 },
        rotation: -28.5,
      },
      spots: NO_SPOTS,
      view: { center: { lat: 48.85, lng: 2.3 }, zoom: 9.75 },
      trip: { from: { lat: 37.4419, lng: -122.143 }, to: { lat: 37.3322, lng: -121.8896 } },
      drive: null,
      rings: false,
    };
    const hash = encodeLink(state);
    expect(hash).toBe(
      'home=37.4275,-122.1697,Stanford,+the+Farm&away=paris&pin=37.4419,-122.143~48.8049,2.1204&turn=-28.5' +
        '&view=48.85,2.3,9.75&trip=37.4419,-122.143~37.3322,-121.8896&rings=0',
    );
    const decoded = decodeLink(`#${hash}`);
    expect(decoded.incomplete).toBe(false);
    expect(decoded.state).toEqual(state);
  });

  it('round-trips a pin, view and trip in the far north and south, up to the edge of the map', () => {
    for (const lat of [85.02, -85.02, MAX_MERCATOR_LAT, -MAX_MERCATOR_LAT]) {
      const state: LinkState = {
        ...defaultLinkState(),
        reg: { overlayAnchor: { lat: 37.4419, lng: -122.143 }, baseAnchor: { lat, lng: 20.5 }, rotation: 0 },
        view: { center: { lat, lng: 20.5 }, zoom: 16 },
        trip: { from: { lat, lng: -122.143 }, to: { lat: 37.3322, lng: -121.8896 } },
      };
      const decoded = decodeLink(`#${encodeLink(state)}`);
      expect(decoded.incomplete).toBe(false);
      for (const at of [decoded.state.reg.baseAnchor, decoded.state.view?.center, decoded.state.trip?.from]) {
        expect(Math.abs((at?.lat ?? 0) - lat)).toBeLessThan(1e-5);
        expect(Math.abs(at?.lat ?? 0)).toBeLessThanOrEqual(MAX_MERCATOR_LAT);
      }
    }
  });

  it('still refuses a latitude beyond the edge of the map', () => {
    const { state, incomplete } = decodeLink('#home=san-jose&away=london&pin=37.4419,-122.143~85.06,20.5&view=-85.1,20.5,16');
    expect(incomplete).toBe(true);
    expect(state.reg).toEqual(defaultLinkState().reg);
    expect(state.view).toBeNull();
  });

  it('pins centre on centre when the link has no pin', () => {
    const { state } = decodeLink('#home=san-jose&away=tokyo');
    expect(state.reg).toEqual(centeredRegistration(state.home, state.away));
    expect(state.away.name).toBe('Tokyo');
    expect(state.view).toBeNull();
    expect(state.rings).toBe(true);
  });

  it('gives a preset Home its familiar trip unless the link says otherwise', () => {
    expect(decodeLink('#home=san-jose&away=tokyo').state.trip?.fromName).toBe('Palo Alto');
    expect(decodeLink('#home=san-jose&away=tokyo&trip=none').state.trip).toBeNull();
    expect(decodeLink('#home=berlin&away=san-jose').state.trip).toBeNull();
    const cleared: LinkState = { ...defaultLinkState(), trip: null };
    expect(encodeLink(cleared)).toBe('home=san-jose&away=london&trip=none');
    expect(decodeLink(encodeLink(cleared)).state.trip).toBeNull();
  });

  it('round-trips a drive, which stands in place of the trip', () => {
    const drive = { on: 'home', from: { lat: 37.4419, lng: -122.143 }, to: { lat: 37.3382, lng: -121.8863 }, match: 'time' } as const;
    const state: LinkState = { ...defaultLinkState(), trip: null, drive };
    const hash = encodeLink(state);
    // Home and the same time are what a drive is on and matches unless the link says otherwise.
    expect(hash).toBe('home=san-jose&away=london&drive=37.4419,-122.143~37.3382,-121.8863');
    const decoded = decodeLink(`#${hash}`);
    expect(decoded.incomplete).toBe(false);
    expect(decoded.state).toEqual(state);
  });

  it('round-trips a drive on Away with its names and what its reach matches', () => {
    const drive = {
      on: 'away',
      from: { lat: 51.5308, lng: -0.1238 },
      to: { lat: 51.47, lng: -0.4543 },
      fromName: 'King’s Cross',
      toName: 'Heathrow, Terminal 5',
      match: 'distance',
    } as const;
    const state: LinkState = { ...defaultLinkState(), trip: null, drive };
    const hash = encodeLink(state);
    expect(hash).toBe(
      'home=san-jose&away=london&drive=51.5308,-0.1238~51.47,-0.4543&on=away&df=King%E2%80%99s+Cross&dt=Heathrow,+Terminal+5&same=distance',
    );
    expect(decodeLink(hash).state).toEqual(state);
  });

  it('keeps a drive of a few metres, whose ends the link’s rounding has brought closer together', () => {
    // 10 m apart as it was set; under 9 m as five decimals write it.
    const drive = { on: 'home', from: { lat: 37.44194501, lng: -122.143 }, to: { lat: 37.44203499, lng: -122.143 }, match: 'time' } as const;
    const { state, incomplete } = decodeLink(encodeLink({ ...defaultLinkState(), trip: null, drive }));
    expect(incomplete).toBe(false);
    expect(state.drive).toEqual({ ...drive, from: { lat: 37.44195, lng: -122.143 }, to: { lat: 37.44203, lng: -122.143 } });
    expect(state.trip).toBeNull();
  });

  it('shows the drive and not a trip when a link names both', () => {
    const { state, incomplete } = decodeLink(
      '#home=san-jose&away=london&trip=37.4419,-122.143~37.3322,-121.8896&drive=37.4419,-122.143~37.3382,-121.8863',
    );
    expect(incomplete).toBe(false);
    expect(state.trip).toBeNull();
    expect(state.drive?.on).toBe('home');
  });

  it('falls back to the place’s own trip, and says so, when a drive cannot be understood', () => {
    const cases = [
      '#home=san-jose&away=london&drive=37.4419,-122.143',
      '#home=san-jose&away=london&drive=37.4419,-122.143~37.3382,-121.8863&on=mars',
      '#home=san-jose&away=london&drive=37.4419,-122.143~37.3382,-121.8863&same=speed',
      // Two ends on one spot are no drive.
      '#home=san-jose&away=london&drive=37.4419,-122.143~37.4419,-122.1430000001',
    ];
    for (const hash of cases) {
      const { state, incomplete } = decodeLink(hash);
      expect(incomplete, hash).toBe(true);
      expect(state.home.name, hash).toBe('San Jose');
    }
    expect(decodeLink(cases[0] as string).state.drive).toBeNull();
    expect(decodeLink(cases[0] as string).state.trip?.fromName).toBe('Palo Alto');
    // What could be understood of the others still stands: the drive, on Home, matched by time.
    expect(decodeLink(cases[1] as string).state.drive).toMatchObject({ on: 'home', match: 'time' });
    expect(decodeLink(cases[2] as string).state.drive).toMatchObject({ on: 'home', match: 'time' });
  });

  it('survives names with awkward characters', () => {
    const home: Place = { name: 'Zürich & Winterthur / "Züri" #1', context: '', center: { lat: 47.3769, lng: 8.5417 } };
    const state: LinkState = { ...defaultLinkState(), home, reg: centeredRegistration(home, defaultLinkState().away), trip: null };
    const decoded = decodeLink(encodeLink(state));
    expect(decoded.incomplete).toBe(false);
    expect(decoded.state.home).toEqual(home);
  });

  it('normalises the turn and rounds it to a tenth of a degree', () => {
    const state: LinkState = { ...defaultLinkState(), reg: { ...defaultLinkState().reg, rotation: 190.04 } };
    expect(encodeLink(state)).toContain('turn=-170');
    expect(decodeLink('#home=san-jose&away=london&turn=370').state.reg.rotation).toBe(10);
  });

  it('falls back field by field and reports an incomplete link', () => {
    const cases = [
      '#home=atlantis&away=london',
      '#home=san-jose',
      '#home=san-jose&away=london&pin=1,2',
      '#home=san-jose&away=london&turn=sideways',
      '#home=san-jose&away=london&view=91,0,9',
      '#home=san-jose&away=london&view=51.5,-0.1,99',
      '#home=san-jose&away=london&trip=1,2~3',
      '#home=san-jose&away=london&rings=maybe',
      '#home=12,34&away=london',
      '#garbage',
    ];
    for (const hash of cases) {
      const decoded = decodeLink(hash);
      expect(decoded.incomplete, hash).toBe(true);
      expect(decoded.state.home.name, hash).toBe('San Jose');
      expect(decoded.state.away.name, hash).toBe('London');
      expect(decoded.state.reg.rotation, hash).toBe(0);
    }
  });

  it('keeps the good parts of a partly broken link', () => {
    const { state, incomplete } = decodeLink('#home=san-jose&away=paris&turn=oops&rings=0');
    expect(incomplete).toBe(true);
    expect(state.away.name).toBe('Paris');
    expect(state.rings).toBe(false);
  });

  it('carries the names given to the pin and to the trip', () => {
    const base = defaultLinkState();
    const reg = { overlayAnchor: { lat: 37.3318, lng: -122.0312 }, baseAnchor: { lat: 51.5034, lng: -0.1276 }, rotation: 12 };
    const heathrow = { lat: 51.47, lng: -0.4543 };
    const state: LinkState = {
      ...base,
      reg,
      spots: { home: { name: 'One Infinite Loop', at: reg.overlayAnchor }, away: { name: '10 Downing Street', at: reg.baseAnchor } },
      trip: {
        from: reg.overlayAnchor,
        to: baseToOverlay(reg, heathrow),
        fromName: 'One Infinite Loop',
        toLanding: { name: 'Heathrow Airport', at: heathrow },
      },
    };
    const hash = encodeLink(state);
    expect(hash).toContain('&hs=One+Infinite+Loop&as=10+Downing+Street&turn=12');
    expect(hash).toContain('&tf=One+Infinite+Loop&tl=Heathrow+Airport');
    const decoded = decodeLink(hash);
    expect(decoded.incomplete).toBe(false);
    expect(decoded.state.spots.home).toEqual({ name: 'One Infinite Loop', at: reg.overlayAnchor });
    expect(decoded.state.spots.away?.name).toBe('10 Downing Street');
    expect(decoded.state.trip?.fromName).toBe('One Infinite Loop');
    expect(decoded.state.trip?.toName).toBeUndefined();
    expect(decoded.state.trip?.toLanding?.name).toBe('Heathrow Airport');
    // Rounding the trip's end to a metre in the link moves the landing by no more than that.
    expect(Math.abs((decoded.state.trip?.toLanding?.at.lat ?? 0) - heathrow.lat)).toBeLessThan(2e-5);
  });

  it('drops a name once the thing it named has moved', () => {
    const base = defaultLinkState();
    const moved = { ...base.reg, baseAnchor: { lat: 51.6, lng: -0.2 } };
    const state: LinkState = {
      ...base,
      reg: moved,
      spots: { home: { name: 'My old house', at: base.reg.overlayAnchor }, away: { name: 'Big Ben', at: base.reg.baseAnchor } },
    };
    const hash = encodeLink(state);
    expect(hash).toContain('hs=My+old+house');
    expect(hash).not.toContain('as=');
  });

  it('carries the Away name of a trip’s start as well as its end', () => {
    const base = defaultLinkState();
    const trip = base.trip!;
    const state: LinkState = {
      ...base,
      trip: {
        from: { lat: trip.from.lat + 0.01, lng: trip.from.lng },
        to: trip.to,
        fromLanding: { name: 'Watford Junction', at: overlayToBase(base.reg, { lat: trip.from.lat + 0.01, lng: trip.from.lng }) },
      },
    };
    const hash = encodeLink(state);
    expect(hash).toContain('&ts=Watford+Junction');
    expect(decodeLink(hash).state.trip?.fromLanding?.name).toBe('Watford Junction');
  });

  it('spells out a place’s own trip when the link gave it names of its own', () => {
    const { state } = decodeLink('#home=san-jose&away=london&trip=37.4443,-122.1598~37.3322,-121.8896&ts=Big+Ben&tl=Heathrow');
    expect(state.trip?.fromLanding?.name).toBe('Big Ben');
    const hash = encodeLink(state);
    expect(hash).toContain('trip=37.4443,-122.1598~37.3322,-121.8896');
    expect(hash).toContain('&ts=Big+Ben&tl=Heathrow');
    // The same trip with nothing added stays out of the link.
    expect(encodeLink(defaultLinkState())).toBe('home=san-jose&away=london');
  });

  it('makes names from a link safe to show and to write back', () => {
    // 79 letters and then an emoji: cutting at 80 code units would leave half of it, which no link can carry.
    const cut = decodeLink(`#home=san-jose&away=london&hs=${'a'.repeat(79)}%F0%9F%8F%A0tail`).state;
    expect(Array.from(cut.spots.home!.name)).toHaveLength(80);
    expect(() => encodeLink(cut)).not.toThrow();
    expect(decodeLink(encodeLink(cut)).state.spots.home?.name).toBe(cut.spots.home?.name);
    // A direction override would turn the rest of the sentence around; a lone surrogate cannot be encoded.
    const marked = decodeLink('#home=san-jose&away=london&hs=%E2%80%AEevil%E2%80%AC&as=ok%00%09here').state;
    expect(marked.spots.home?.name).toBe('evil');
    expect(marked.spots.away?.name).toBe('ok here');
    const place = decodeLink('#home=37.4,-122.1,%E2%80%AEStanford&away=london').state.home;
    expect(place.name).toBe('Stanford');
  });

  it('ignores empty names and trims long ones', () => {
    const { state } = decodeLink(`#home=san-jose&away=london&hs=+++&as=${'x'.repeat(200)}`);
    expect(state.spots.home).toBeNull();
    expect(state.spots.away?.name).toHaveLength(80);
  });

  it('never throws on hostile input', () => {
    for (const hash of ['#%', '#home=%E0%A4%A', '#home=' + 'x'.repeat(5000), '#=&=&&', '#home=1e999,5,Nowhere&away=london']) {
      expect(() => decodeLink(hash)).not.toThrow();
    }
  });
});
