# 2047 Binary Merge

Add bits. Reach 2047. A browser puzzle with no account, ads, analytics, external assets, or runtime dependencies.

Play at [apps.prof.ws/2047](https://apps.prof.ws/2047/) or [GitHub Pages](https://sssw.github.io/2047/).

- Classic binary merge, Insane, and 2048 modes; 2–8 rows and columns.
- Swipe, arrow keys, WASD, and optional direction buttons.
- Local saves, undo/redo, best scores, seeded challenges, and portable saved-game links.
- Accessible DOM, documented JavaScript API, WebMCP tools, and URL configuration.
- Responsive layouts, light/dark themes, reduced motion, and adjustable sound effects.

The engine matches the iOS binary merge rules and uses FNV-1a seed hashing with SplitMix64. Classic and Insane spawn 1; 2048 spawns 2. Each tile merges at most once per move. Only a move that changes the board spawns a tile.

See [the interface documentation](site/api.html) or [agent.json](site/agent.json) for integration details. A reproducible session uses `?seed=hello&size=4&save=0`.

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
