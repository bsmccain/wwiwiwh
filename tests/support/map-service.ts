import type { BrowserContext, Route } from '@playwright/test';

const HOST = 'https://tiles.openfreemap.org';
/** Requests from the page are cross-origin; without this header the browser would refuse the answers. */
const CORS = { 'access-control-allow-origin': '*' };

/**
 * The description of the tile source, cut down to what MapLibre needs. It names tiles on the same
 * host, as the real one does, so they come back to this stub. It lists no `vector_layers`: with a
 * list, MapLibre checks every style layer against it and reports the ones that are missing.
 */
const TILEJSON = {
  tilejson: '3.0.0',
  tiles: [`${HOST}/planet/fixture/{z}/{x}/{y}.pbf`],
  minzoom: 0,
  maxzoom: 14,
};

/** The stand-in for the public tile service, and the switches a test can throw on it. */
export interface MapService {
  /** The whole service is out of reach: nothing it is asked for arrives. */
  down: boolean;
  /** The source's description still arrives, but no tile does. */
  tilesFailing: boolean;
  /** What every tile holds, as a vector tile. Null, as it is to begin with, for tiles with nothing in them. */
  tile: Buffer | null;
  /** What the page has asked for so far. */
  readonly requests: { tileJson: number; tiles: number; glyphs: number };
  /**
   * Keeps back every tile asked for from now on, as a slow connection would, until the function this
   * returns is called.
   */
  holdTiles(): () => void;
  /** Steps aside, so that what the maps ask for from now on goes to the public service itself. */
  stepAside(): Promise<void>;
}

/**
 * Answers everything the maps ask of the tile service from here, so no test leans on the public
 * server. Tiles are empty unless a test says otherwise: MapLibre takes a 204 for a tile with nothing
 * in it and draws the sheet's background. Glyph ranges are empty protobufs, which are valid and hold
 * no glyphs.
 */
export async function stubMapService(context: BrowserContext): Promise<MapService> {
  const everything = `${HOST}/**`;
  /** Settles when tiles may be answered again; null while nothing keeps them back. */
  let tilesLetGo: Promise<void> | null = null;
  const service: MapService = {
    down: false,
    tilesFailing: false,
    tile: null,
    requests: { tileJson: 0, tiles: 0, glyphs: 0 },
    holdTiles() {
      let letGo = (): void => undefined;
      tilesLetGo = new Promise<void>((resolve) => {
        letGo = resolve;
      });
      return () => {
        tilesLetGo = null;
        letGo();
      };
    },
    stepAside: () => context.unroute(everything, answer),
  };

  async function answer(route: Route): Promise<void> {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/planet') {
      service.requests.tileJson++;
      if (service.down) return route.abort('connectionrefused');
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(TILEJSON) });
    }
    if (pathname.startsWith('/planet/')) {
      service.requests.tiles++;
      await tilesLetGo;
      if (service.down || service.tilesFailing) return route.abort('connectionrefused');
      if (!service.tile) return route.fulfill({ status: 204, headers: CORS });
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/x-protobuf', body: service.tile });
    }
    if (pathname.startsWith('/fonts/')) {
      service.requests.glyphs++;
      if (service.down) return route.abort('connectionrefused');
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
    }
    return route.fulfill({ status: 404, headers: CORS });
  }

  await context.route(everything, answer);
  return service;
}
