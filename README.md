# 2047 Binary Merge

Add bits. Reach 2047. A browser puzzle with no account, ads, analytics, external assets, or runtime dependencies.

Play at [apps.prof.ws/2047](https://apps.prof.ws/2047/) or [GitHub Pages](https://sssw.github.io/2047/).

- Classic binary merge, Insane, and 2048 modes; 2–8 rows and columns.
- Swipe, arrow keys, WASD, and optional direction buttons.
- Local saves, undo/redo, best scores, seeded challenges, and portable saved-game links.
- Accessible DOM, documented JavaScript API, WebMCP tools, and URL configuration.
- Responsive layouts, light/dark themes, reduced motion, and adjustable sound effects.

The engine matches the iOS binary merge rules. Classic and Insane spawn 1; 2048 spawns 2. Each tile merges at most once per move. Only a move that changes the board spawns a tile.

See [the interface documentation](site/api.html) or [agent.json](site/agent.json) for integration details. A reproducible session uses `?seed=hello&size=4&save=0`.

## Tile generation

Omitting the seed starts a random game. Every spawn draws fresh `crypto.getRandomValues()` entropy, with rejection sampling to avoid modulo bias. Future entropy is never part of a snapshot. Undo/redo restore recorded positions; a new move after undo draws fresh randomness. There is no clock-based or `Math.random()` fallback.

Seeded version 2 uses a 256-bit SHA-256 chain coupled to the complete board, direction, previous chain state, seed, mode, shape, score, and move count. Each spawn performs 32 sequential hashes, followed by unbiased selection. This prevents a board-independent spawn stream and adds bounded work to each search branch. It cannot prevent simulation of a public deterministic algorithm and is not an anti-cheat mechanism. The synchronous engine keeps the existing API.

Version 1 used seeds for all sessions, including automatically chosen ones. Saved boards and undo/redo snapshots upgrade to version 2 seeded continuation; the future sequence changes. Legacy URL save keys are recovered. Random URL configurations have stable save slots despite fresh starting boards. Fresh unseeded games use random mode.

The hash is checked against Node’s SHA-256 and fixed vectors. Algorithm references: [FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final) and [Web Crypto](https://www.w3.org/TR/webcrypto/#Crypto-method-getRandomValues).

## Run and test

Serve `site/` with any static HTTP server. No build step or package installation is required. Node.js 22 or later runs the tests:

```sh
npm test
```

To measure browser performance, serve the project root and open `tests/performance.html`. The benchmark measures synchronous move handling and the next animation frame, with local saves both on and off.

Only `site/` is deployed. GitHub Actions validates the engine before publishing GitHub Pages on pushes to `main`. Assets use relative URLs and work under `/2047/` on both hosts. The shared domain receives the same static files under its `2047/` directory.

## License

Free for noncommercial purposes under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires a separate written license. [Request commercial permission](https://apps.prof.ws/binary-tile/support/).

The [iOS app](https://apps.apple.com/app/id6762283493) has its own App Store terms.
