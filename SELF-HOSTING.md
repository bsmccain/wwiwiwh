# Running your own copy

You don't need any of this to use wwiwiwh. It's at [wwiwiwh.com](https://wwiwiwh.com), and the [README](README.md) explains how to use it. This page is for anyone who wants to run it on their own machine, host their own copy, or change the code.

wwiwiwh is a static site with no server side and no API keys. The browser talks straight to three free public services for tiles, place search and driving routes.

## Running it locally

You need Node 22 or newer.

```sh
git clone https://github.com/bsmccain/wwiwiwh.git
cd wwiwiwh
npm install
npm run dev            # http://127.0.0.1:5173
```

Other scripts:

```sh
npm test               # unit tests
npm run test:e2e       # browser tests against a production build
npm run test:e2e:live  # one smoke test against the real tile service
npm run build          # static site in dist/
npm run inks           # rewrite src/styles/ink-sets.css after changing a colour in src/app/theme.ts
```

The browser tests answer tile, search and routing requests from local fixtures in `tests/support/`, so they run offline. They use Playwright's Chromium, which `npx playwright install chromium` fetches.

## Hosting it

`npm run build` writes a plain static site to `dist/`. Upload that folder to any static host: Cloudflare Pages, GitHub Pages, Netlify, an S3 bucket, or nginx serving a directory.

- **Sub-paths work.** Asset paths are relative, so `https://example.com/wwiwiwh/` is fine.
- **No server routing.** The view lives in the part of the address after `#`, so the host only has to serve `index.html` and the files next to it.
- **Content-Security-Policy.** The page runs no inline scripts. If you set a policy, it has to allow connections to the three services below.
- **Source maps.** The build writes a `.map` file next to the main script. Delete them before uploading if you don't want to publish them.

### The GitHub Actions deploy

wwiwiwh.com deploys through [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Publishing a GitHub release from `main` runs the unit tests, builds, and deploys `dist/` to the Cloudflare Pages project `wwiwiwh`. Pushes and pull requests don't deploy. Running the workflow by hand redeploys the latest `main`.

To use it from a fork:

1. Create a Cloudflare Pages project, and change `--project-name=wwiwiwh` in the workflow to its name.
2. Add a repository secret `CLOUDFLARE_API_TOKEN`, a token with permission to edit Cloudflare Pages.
3. Add a repository variable `CLOUDFLARE_ACCOUNT_ID`.
4. Publish a release from `main`, or run the workflow by hand.

If you host somewhere else, delete the workflow or disable it under the Actions tab. Without the secret it fails on every release.

## The outside services

| What | Service | Set in |
|---|---|---|
| Vector tiles and label fonts | [OpenFreeMap](https://openfreemap.org) | `TILES` and `GLYPHS` in `src/map/style/index.ts` |
| Place search | [Photon](https://photon.komoot.io) from komoot | `PHOTON_SEARCH_URL` in `src/search/photon.ts` |
| Driving routes and reach outlines | [Valhalla](https://valhalla.github.io/valhalla/) on the [FOSSGIS](https://www.fossgis.de/) server | `VALHALLA_URL` in `src/routing/valhalla.ts` |

None of them needs a key, and none of them promises uptime. All three expect fair use. That's fine for a personal copy. A copy with many visitors should run its own services, starting with Valhalla. The FOSSGIS server allows one request a second and isn't meant for busy sites. wwiwiwh already asks it one thing at a time and remembers the answers, but heavy traffic will still get you blocked.

Each of the three can be self-hosted:

- **Tiles.** OpenFreeMap publishes its whole setup. Any server of vector tiles in the [OpenMapTiles](https://openmaptiles.org) schema will do, since the map styles in `src/map/style/` read that schema's layers.
- **Search.** Photon is open source and runs from a downloadable index.
- **Routing.** Valhalla is open source. Your server has to answer GET requests from the browser with `access-control-allow-origin` set. The comment at the top of `src/routing/valhalla.ts` lists what the code expects from the server's answers.

If you change a service, also change:

- the credits in the About dialog (`src/ui/dialogs.ts`) and in the share sheet (`src/ui/share.ts`);
- the "What leaves your browser" and credits sections of the README, if your copy has its own;
- the fixtures in `tests/support/`, which intercept requests by host name.

The About dialog links to this repository through `REPO` in `src/ui/dialogs.ts`. Point it at your fork if you publish changes.

## How the scale matching works

Both maps are Web Mercator, which stretches the ground by 1 / cos(latitude). London at 51.5° north is drawn about 28% larger than San Jose at 37.3° for the same zoom level. wwiwiwh cancels that by running Home at a different zoom, offset by log2 of the ratio of the two cosines at the pin.

The two maps are tied by one similarity transform in Mercator space, held in `src/geo/registration.ts`. Because it is a single rigid transform, the maps can't drift against each other while you pan. The match is tightest at the pin and stays within about 1% across a metro-sized view. Far from the pin, or zoomed out to a whole country, the two projections stretch differently and the caption says so.

The maths treats the Earth as a sphere. On the real, slightly flattened Earth the match at the pin can be off by up to about half a percent between very different latitudes.

## Where things are

```
src/geo/          Mercator, the registration transform, distances, units
src/map/          the locked pair of MapLibre maps, gestures, both map styles
src/labels/       place names for both maps, with one collision pass between them
src/instruments/  pin, turn knob, rings, trip line, a drive's ends and rings, bar scale
src/search/       place picker, Photon search, presets
src/routing/      driving routes and reach outlines from Valhalla
src/app/          state, actions, address-bar syncing, the caption sentences
src/ui/           the bottom strip, caption, menus, dialogs, keyboard
src/data/         171 metro presets and a familiar trip for 14 of them
tests/            Playwright tests
```

Place names are DOM elements on one layer above both maps, not MapLibre labels. That way a Home name and an Away name can avoid each other, and Away's names stay readable on top of Home's lines.

## Sending changes back

See [CONTRIBUTING.md](CONTRIBUTING.md).
