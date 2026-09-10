# React dashboard architecture and migration status

The React + TypeScript + Vite dashboard is now the supported interface at `/app`. Express, the JavaScript crawler engine and optional MySQL storage remain the backend. The public homepage is at `/`.

See [the full documentation](src/public/info/docs.html#architecture) for the current code map and API reference.

## Current structure

- `src/client/App.tsx`: dashboard composition, configuration and page inspection.
- `src/client/features/`: pages, links, resources, issues, content, history and crawl state.
- `src/client/api/crawler-client.ts`: typed API access.
- `src/client/types/crawl.ts`: shared client-facing data shapes.
- `src/client/features/crawl/liveCrawler.ts`: revision-aware live-state controller with snapshots, SSE and fallback.
- `src/shared/seoIssues.js`: browser-safe rules consumed by the dashboard and server exports.
- `src/public/next/`: compiled React output, committed for the current hosting workflow.

The `/next/` asset base is protected and noindex. It is retained as an asset path, not a second public application.

## Session contract

The React client obtains a server-issued dashboard session bound to the signed-in admin session. It uses the `crawlloom-dashboard-session` sessionStorage key. Server-side session ownership protects controls, results, streams and exports.

The legacy static dashboard has been removed. The React dashboard at `/app` is the only supported dashboard interface.

New UI work belongs in `src/client/`; do not add static dashboard logic under `src/public/`.

## Delivered functionality

The React interface includes crawl configuration and controls, live progress and capacity, page data subtabs, link/resource discovery, shared SEO issues and exact duplicates, content inspection, source/rendered code capture, exports, saved-history restoration and completion notifications.

The live controller starts with an atomic snapshot, applies revision-ordered SSE updates, resynchronizes after commands/reconnects, and uses bounded polling when the stream becomes unhealthy. Healthy SSE no longer needs continuous full-result polling.

## Development

```sh
npm run typecheck
npm test
npm run client:build
```

The build checks TypeScript before generating assets. Test the integrated application through Express at `/app` after rebuilding. `npm run dev` watches only the Node process; `npm run client:dev` starts Vite without an API proxy and is not a complete authenticated development setup by itself.

Keep the compiled output in the same commit as changes that affect the React build. Push only as an approved deployment batch.
