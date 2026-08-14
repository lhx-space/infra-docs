# @luhanxin/error-monitor

> A lightweight, framework-agnostic error monitoring toolkit for browser and WebView-based hybrid apps — render errors, runtime exceptions, unhandled rejections, resource load failures, and WebSocket/SSE connection failures, unified into a single reportable protocol.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

## Features

- **Unified error protocol** — every source (render, runtime, promise, resource, network, manual) produces the exact same `ErrorReport` shape, distinguished only by a `source` field.
- **6 capture sources**, all opt-in per source where it matters:
  - `render` — React `ErrorBoundary` + root-level `onUncaughtError`/`onCaughtError`/`onRecoverableError`, or Vue `errorHandler`/`onErrorCaptured`
  - `runtime` — uncaught synchronous exceptions (`window.onerror`)
  - `promise` — unhandled `Promise` rejections
  - `resource` — `<img>`/`<script>`/`<link>` load failures
  - `network` — **connection-level** `WebSocket`/`EventSource` failures (explicit opt-in via `registerNetworkConnection`, not auto-instrumented)
  - `manual` — `reportError()` for already-`catch`'d errors you still want to keep a trail of
- **Dedupe + throttle** — a fingerprint-based dedupe window collapses noisy repeats into one summary record; an optional global throttle caps total volume per window (with a `fatal`-level bypass).
- **Pluggable reporters** — register as many `Reporter` implementations as you like; one throwing never blocks the others. Ships with `ConsoleReporter` (dev-friendly structured logging) and `HttpReporter` (production-grade, durable delivery).
- **Trace-id correlation** — an optional `extractTraceInfo` hook lets you tag `promise`/`manual` reports with a backend-correlatable trace id (e.g. from an API error response header), without this package knowing anything about HTTP.
- **Zero framework lock-in in core** — `@luhanxin/error-monitor` has no React/Vue dependency; `/react` and `/vue` are separate subpath entries you only pay for if you import them.

## Environment support

This package targets **browsers and WebView-based hybrid apps** (Cordova/Ionic/Capacitor, Electron renderer, etc. — anywhere a real DOM is present). It is **not** designed for React Native (Hermes/JSC without a DOM) or a plain Node.js server:

| Capability | Browser / WebView-hybrid | Node.js | React Native |
| --- | --- | --- | --- |
| `render` (`ErrorBoundary`) | ✅ | — | ✅ (pure React, no DOM) |
| `render` (`createRootErrorHandlers`) | ✅ (`react-dom` root option) | — | ⚠️ RN doesn't use `react-dom` |
| `runtime` / `promise` / `resource` | ✅ (`window` listeners) | ⚪️ no-op (guarded, never throws) | ❌ |
| `network` (`registerNetworkConnection`) | ✅ (native `WebSocket`/`EventSource`) | ⚠️ works only if you pass an `EventTarget`-compatible `WebSocket`; no native `EventSource` | ❌ (no `EventSource`) |
| `HttpReporter` durable queue | ✅ (`IndexedDB` → `localStorage` → memory) | ⚪️ falls back to an in-memory queue | ❌ |

`⚪️` = degrades to a safe no-op / in-memory fallback instead of throwing, but the capability isn't actually useful there.

## Install

```bash
npm install @luhanxin/error-monitor
# or
pnpm add @luhanxin/error-monitor
```

React/Vue are optional peer dependencies — only required if you import the `/react` or `/vue` subpath.

## Quick start

```ts
import {ConsoleReporter, initErrorMonitor} from '@luhanxin/error-monitor';

initErrorMonitor({
  reporters: [new ConsoleReporter()],
  appName: 'my-app',
  appVersion: '1.0.0'
});
```

This mounts the global listeners for `render`(partially)/`runtime`/`promise`/`resource`. For React apps, also wire up the root-level callbacks so uncaught render errors are captured too:

```tsx
import {createRootErrorHandlers} from '@luhanxin/error-monitor/react';
import {createRoot} from 'react-dom/client';

createRoot(document.getElementById('root')!, createRootErrorHandlers()).render(<App />);
```

## Guides

### Reporting a network connection failure (`WebSocket`/`EventSource`)

`network` sources are **never auto-instrumented** — you explicitly register the exact instance you care about, and get back an unregister function:

```ts
import {registerNetworkConnection} from '@luhanxin/error-monitor';

const ws = new WebSocket('wss://example.com/realtime');
const unregister = registerNetworkConnection(ws, 'websocket', 'my-realtime-channel');

// later, when this specific socket is no longer relevant (e.g. before a manual reconnect
// creates a brand-new WebSocket instance):
unregister();
```

Only **connection-level** failures are captured (failed handshake, abnormal close code, repeated reconnect failure) — message-level parsing errors and HTTP status codes are intentionally out of scope; those belong to APM, not crash reporting.

### Correlating a network error with backend logs (trace id)

```ts
import {initErrorMonitor} from '@luhanxin/error-monitor';
import {ApiError} from './api-error'; // your own HTTP error class

initErrorMonitor({
  reporters: [/* ... */],
  extractTraceInfo: reason =>
    reason instanceof ApiError ? {traceId: reason.traceId, extra: {httpStatus: reason.status}} : undefined
});
```

`extractTraceInfo` is invoked for the `promise` (unhandled rejection) and `manual` (`reportError()`) sources — it never assumes anything about `fetch`/HTTP, so any transport works.

### Manual reporting

```ts
import {reportError} from '@luhanxin/error-monitor';

try {
  await doSomethingRisky();
} catch (err) {
  reportError(err, {context: 'checkout-flow'});
}
```

### Durable HTTP reporting in production

```ts
import {HttpReporter} from '@luhanxin/error-monitor';

const reporter = new HttpReporter({
  endpoint: 'https://your-backend.example.com/errors',
  getHeaders: () => ({Authorization: `Bearer ${getAccessToken()}`})
});
```

`HttpReporter` never depends on a single "send it before the page dies" trick (no `navigator.sendBeacon`, no reliance on `fetch({keepalive: true})` alone). Every report is first written to a durable local queue — `IndexedDB`, falling back to `localStorage`, falling back to an in-memory queue if neither is available — *before* a network send is attempted. Delivery is retried opportunistically on `pagehide`/`visibilitychange`, and unresolved entries are retried again on the next app startup. A failed send is only ever logged with `console.error`; it never re-enters the reporting pipeline.

If you run more than one `HttpReporter` instance against different endpoints in the same page, give each one a distinct `storage` option so their local queues don't collide:

```ts
new HttpReporter({
  endpoint: 'https://errors.example.com',
  storage: {dbName: '__errors_queue__', storeName: 'queue', localStorageKey: '__errors_queue__'}
});
```

### Dedupe & throttle

```ts
initErrorMonitor({
  reporters: [/* ... */],
  dedupe: {windowMs: 10_000, maxCountPerWindow: 20},
  throttle: {windowMs: 60_000, maxCount: 50, allowFatal: true}
});
```

Both can be adjusted at runtime without re-mounting listeners:

```ts
import {configureErrorMonitorNoiseControl} from '@luhanxin/error-monitor';

configureErrorMonitorNoiseControl({throttle: null}); // disable throttling
```

### DevTools panel

A small floating panel that lets you trigger each capture source on demand — handy while wiring things up locally.

```tsx
import {ErrorMonitorDevTools} from '@luhanxin/error-monitor/react';

<ErrorMonitorDevTools enabled={import.meta.env.DEV} />;
```

## API reference

### Core (`@luhanxin/error-monitor`)

| Export | Description |
| --- | --- |
| `initErrorMonitor(options)` | Mounts global listeners and configures reporters/dedupe/throttle/`extractTraceInfo`. Safe to call again (re-mounts, doesn't duplicate listeners). |
| `setErrorMonitorUser(userId)` | Tags subsequent reports with a `userId`. Pass `undefined` to clear (e.g. on logout). |
| `configureErrorMonitorNoiseControl(options)` | Adjusts `dedupe`/`throttle` at runtime without re-mounting listeners. |
| `reportError(error, extra?, options?)` | Manual reporting for already-handled errors. |
| `registerNetworkConnection(connection, kind, label?)` | Opts a `WebSocket`/`EventSource` instance into the `network` source. Returns an unregister function. |
| `ConsoleReporter` | Built-in `Reporter` that logs a structured object to the console. |
| `HttpReporter` | Built-in `Reporter` with a durable local queue (see above). |
| Types | `ErrorReport`, `ErrorSource`, `ErrorLevel`, `Reporter`, `BeforeSendHook`, `DedupeOptions`, `ThrottleOptions`, `TraceInfoExtractor`, `NetworkConnectionKind`, `HttpReporterOptions`, `PersistentQueueOptions`, `InitErrorMonitorOptions`, `ReportErrorOptions` |

### React (`@luhanxin/error-monitor/react`)

| Export | Description |
| --- | --- |
| `ErrorBoundary` | Class component; catches render/lifecycle/constructor errors in its subtree, shows `fallback`. |
| `createRootErrorHandlers()` | Returns `{onUncaughtError, onCaughtError, onRecoverableError}` — spread into `createRoot(container, options)`. |
| `ErrorMonitorDevTools` | Floating debug panel (see Guides above). |

### Vue (`@luhanxin/error-monitor/vue`)

Supports Vue 3 and Vue 2.7+ (via `vue-demi`).

| Export | Description |
| --- | --- |
| `ErrorBoundary` | Composition-API component; wraps `onErrorCaptured`, shows `fallback`. |
| `createVueErrorHandler()` | Returns a function suitable for `app.config.errorHandler` (Vue 3) / `Vue.config.errorHandler` (Vue 2). |

## Design notes

- `network` intentionally only covers **connection-level** WebSocket/SSE failures — not per-message errors, not HTTP status codes/latency. That boundary is deliberate: HTTP failures already surface through the `promise` source when uncaught, and folding "service failure rate" into a protocol designed for JS crashes would blur two very different concerns (crash reporting vs. APM).
- Registration for `network`/reconnecting transports (e.g. `y-websocket`'s `WebsocketProvider`, which creates a brand-new native `WebSocket` on every reconnect) is the caller's responsibility — this package only understands raw `WebSocket`/`EventSource` instances, not any particular wrapper library.
- `HttpReporter`'s reliability model deliberately does **not** hinge on picking the "right" unload-time transport API — every report lands in durable storage synchronously before any network attempt, so a failed/interrupted send is a retry, not data loss.

## Docs

Source, issues and the rest of the monorepo live at <https://github.com/lhx-space/infra-docs/tree/main/packages/error-monitor>.

## License

MIT © luhanxin
