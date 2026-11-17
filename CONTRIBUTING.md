# Contributing

Open an issue for a bug or proposed change, or send a focused pull request. For bugs, include the browser and operating system, the version or commit, steps to reproduce, and what you expected to happen. Remove real addresses and shared links that contain them from reports and screenshots. Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Development

[SELF-HOSTING.md](SELF-HOSTING.md) has the full setup and a map of the code. In short, install Node 22 or later, clone the repository, and run:

```sh
npm install
npm test               # unit tests
npm run test:e2e       # browser tests against a production build
npm run build          # static site in dist/
```

The browser tests use Playwright's Chromium (`npx playwright install chromium`) and answer tile, search and routing requests from local fixtures, so they run offline. Keep it that way: new tests shouldn't depend on OpenFreeMap, Photon or the routing server. `npm run test:e2e:live` is the one smoke test that uses the real tile service.

Add tests for behaviour changes, and check new UI on both desktop and phone sizes. If you change a colour in `src/app/theme.ts`, run `npm run inks` to regenerate `src/styles/ink-sets.css`. Keep the README's "What leaves your browser" section accurate whenever a change affects what the app sends to an outside service.

Describe what your pull request changes and how you checked it. Contributions are covered by the repository's [MIT license](LICENSE).
