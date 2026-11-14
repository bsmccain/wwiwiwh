<img src="assets/icon.svg" width="64" height="64" alt="">

# wwiwiwh

**Where Was I When I Was Here.** Lay the street map of a place you know over a place you don't, at the same scale.

If you grew up somewhere, you carry its distances around with you. wwiwiwh draws that place, called Home, as red line-work on top of another place, called Away. Palo Alto to downtown San Jose is 16.7 miles. Put San Jose on central London and Palo Alto lands a few miles short of Watford.

![San Jose's streets in red over London in blue](assets/screenshot.jpg)

## Using it

- **Pick two places.** The legend at the bottom left is also the pair of pickers. 171 metro areas are built in, and search finds any other city, town or neighbourhood.
- **Look around.** Drag, scroll and pinch move both maps together.
- **Slide Home.** Hold Shift and drag, or switch on Slide Home and drag. On a phone, Slide Home also gives you nudge buttons.
- **Turn Home.** Hold Alt and drag, right-drag, use the Turn buttons, or drag the knob on the ring around the pin. In slide mode a two-finger twist turns it.
- **The pin.** It marks the one spot where a Home position and an Away position are held together. Home turns about it, and the scale match is tightest there. Grabbing Home somewhere moves the pin to that spot, so you can drop one landmark on another and then turn Home until a second pair lines up. You can also drag the pin itself. When the pin ends up under your cursor without you going to it (after a slide, after picking a spot, on first load), it ignores presses until the cursor has moved away, so a drag from that spot pans both maps. The ends of a measured line behave the same way.
- **Set the pin by address.** Click the pin, press `A`, or pick "Set the pin by address" under More. Choose a Home spot and an Away spot by typing an address, a landmark or a neighbourhood. A Home spot is brought under the pin. An Away spot moves the pin there, with its Home spot. Both maps centre on the pin and zoom in to street scale. The two names in the pin sentence are buttons that open the same search, and recent spots are remembered on your device. Under More, "Recent places and spots" clears them or stops keeping them.
- **Measure.** Click two points to draw a line you know. The line belongs to Home and rides along when you slide or turn it. The caption says how long it is and where it runs on Away. "To an address" draws the line to an address on either place, from the pin or from a start you clicked.
- **Drive.** Click where a drive starts and where it ends, and it is drawn along the real roads with its distance and an estimated time. A drive is on one place: Home at first, and after that whichever place the last drive was on. Switch with "On Away" before placing the start. The other place then shades how far the same amount of time would get you from the spot the start lands on, or the same distance with "Same distance". Two rings go about the start, on both maps: a dashed one through the end, labelled with the distance between the two as the crow flies, and one of dashes and dots as far out as the drive is long by road. Slide or turn Home and the shading is worked out again from the new spot. "To an address" picks both ends by address, and "By road" on a measured line turns it into a drive between the same two ends.
- **Land and water.** Parks, woods, built-up areas and water are shaded for one place at a time: Away at first, with Home drawn over it as streets only. Under More, "Land and water from" (or `T`) gives them to Home instead. Home then lies underneath and Away is drawn over it as streets only.
- **Rings** draw round distances about the pin. **Hide Home** blinks the overlay off while you hold it, or latches on a quick tap. **Swap** exchanges the two places.
- **Copy link** gives an address that reopens the same view. The address bar updates as you go, so Back returns to the previous pair of places.
- **Colours.** More has seven sets of inks, each in a light and a dark version. Kingfisher (orange over blue) and Thistle (purple over green) keep Home and Away apart with red-green or blue-yellow colour blindness. Newsprint uses no colour at all. Stark is black and white, with every ink at 7:1 or better. Classic, Parchment and Blueprint are there for taste. The choice stays on your device.

Measure gives straight lines. Drive gives distances by road and times for a car without traffic, both estimates from OpenStreetMap data. There is one of the two on the map at a time.

## Keyboard

| Key | Does |
|---|---|
| Arrows | Move both maps |
| `+` `-` | Zoom |
| Shift + arrows | Slide Home (add Alt for small steps) |
| `[` `]` | Turn Home 5° (add Shift for 1°) |
| `0` | Square Home up |
| `S` | Slide Home on or off |
| `M` | Measure on or off. While measuring, Enter drops a line end at the centre |
| `D` | Drive on or off. While setting a drive, Enter drops an end at the centre |
| `G` | Rings on or off |
| `H` | Hide Home while held |
| `X` | Swap Home and Away |
| `P` | Put the pin at the centre of the view |
| `A` | Set the pin by address |
| `R` | Line up again |
| `U` | Miles or kilometres |
| `T` | Shade the land and water of Home or of Away |
| `1` `2` | Choose Home, choose Away |
| `C` | Copy link |
| `?` | Show the list of keys |
| Esc | Leave Slide Home, Measure or Drive |

The single-letter keys can be switched off under More.

## Running it

Needs Node 22 or newer.

```sh
npm install
npm run dev            # http://127.0.0.1:5173
npm test               # unit tests
npm run test:e2e       # browser tests against a production build
npm run test:e2e:live  # one smoke test against the real tile service
npm run build          # static site in dist/
npm run inks           # rewrite src/styles/ink-sets.css after changing a colour in src/app/theme.ts
```

`dist/` is a plain static site with no server side. It works from a sub-path, so any static host will do.

The browser tests answer tile and search requests from local fixtures, so they run offline. They use Playwright's Chromium, which `npx playwright install chromium` fetches.

## How the scale matching works

Both maps are Web Mercator, which stretches the ground by 1 / cos(latitude). London at 51.5° north is drawn about 28% larger than San Jose at 37.3° for the same zoom level. wwiwiwh cancels that by running Home at a different zoom, offset by log2 of the ratio of the two cosines at the pin.

The two maps are tied by one similarity transform in Mercator space. `src/geo/registration.ts` holds it. Because it is a single rigid transform, the maps cannot drift against each other while you pan. The match is tightest at the pin and stays within about 1% across a metro-sized view. Far from the pin, or zoomed out to a whole country, the two projections stretch differently and the caption says so.

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

Place names are DOM elements on one layer above both maps, not MapLibre labels. That is what lets a Home name and an Away name avoid each other, and keeps Away's names readable on top of Home's lines.

## Data and services

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Vector tiles from [OpenFreeMap](https://openfreemap.org), in the OpenMapTiles schema. No API key.
- Place search by [Photon](https://photon.komoot.io) from komoot. No API key.
- Driving routes and reach outlines by [Valhalla](https://valhalla.github.io/valhalla/), on the server [FOSSGIS](https://www.fossgis.de/) runs for OpenStreetMap. No API key.
- Maps drawn with [MapLibre GL JS](https://maplibre.org).
- Typefaces Barlow and Barlow Semi Condensed, under the SIL Open Font License.

OpenFreeMap, Photon and the FOSSGIS routing server are free public services with no uptime promise and a fair-use expectation. If tiles fail to load, wwiwiwh says so and retries on its own. The routing server allows one request a second and is not meant for busy sites, so wwiwiwh asks it one thing at a time, remembers its answers, and after a failure waits for you to press "Try again". A copy of wwiwiwh with many visitors should run its own Valhalla.

Addresses you search for are sent to Photon to be looked up. The two ends of a drive, and the spot its start lands on in the other place, are sent to the routing server. A link you copy carries the pin's position, any drive, and any names you gave their spots, so a link made with your home address pinned contains that address.

## Known limits

- Tested mostly in headless Chromium, with spot checks in Firefox and WebKit. No real phone, Mac or screen reader has been tried.
- On a phone, a pin or line end that was just set pans the map when you drag it, until you touch the map somewhere else.
- Address search waits for three characters, so a two-character name finds nothing.
- A line end that sits exactly under the pin cannot be grabbed with a pointer. Drag the other end, or draw the line again with Measure.
- A drive's ends cannot be dragged. Set the drive again with Drive.
- The shaded reach is only worked out for drives of up to 60 minutes (by time) or 100 km (by distance), and no drive longer than 1,500 km is worked out at all. Those are the routing server's limits.
- Subway and tram lines are missing below street zoom, because the tiles only carry them at zoom 14.
- A place name can sit on top of a route-number shield.

---

Created in [T3 Code](https://t3.codes).
