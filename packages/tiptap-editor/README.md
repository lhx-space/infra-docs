# @luhanxin/tiptap-editor

> A batteries-included block-based rich text document editor built on [Tiptap](https://tiptap.dev/) v3 + React, with first-class real-time collaboration.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

**[English](./README.md) | [简体中文](./README.zh-CN.md)**

## Features

- **Rich content model** — headings, paragraphs, ordered/unordered/task lists (with nesting), blockquotes, horizontal rules, and inline formatting (bold/italic/strike/inline code/links) via `@tiptap/starter-kit`.
- **Syntax-highlighted code blocks** — 12 languages out of the box (`@tiptap/extension-code-block-lowlight` + `lowlight`), with Tab-to-indent.
- **Images** — paste/drag-and-drop/upload with a pending placeholder, drag-to-resize, and left/center/right alignment.
- **Tables** — full table/row/header/cell support with draggable column widths (`@tiptap/extension-table`).
- **Mermaid diagrams** — a custom node view with a split source/preview editing mode, viewport-aware lazy rendering (`IntersectionObserver`), and a zoomable fullscreen preview in display mode.
- **Video embeds** — a custom node view covering `processing`/`ready`/`failed` transcoding states, HLS playback via `hls.js` loaded on demand, poster-first click-to-play, and fully custom playback controls.
- **Link preview cards** — paste a URL, get back a rich preview card (title/description/image/favicon) via a consumer-supplied fetcher.
- **Slash commands** — a `/`-triggered menu for quick block insertion.
- **Document outline** — a heading-based table of contents with click-to-scroll, exported standalone for custom layouts.
- **Real-time collaboration** — pass in a `Y.Doc` and an `awareness`-exposing provider (e.g. `y-websocket`'s `WebsocketProvider`) and the editor automatically switches to CRDT-driven sync, rendering collaborator cursors and an online-user list.

## Install

```bash
npm install @luhanxin/tiptap-editor
# or
pnpm add @luhanxin/tiptap-editor
```

`react` and `react-dom` (≥18) are peer dependencies — bring your own version, this package doesn't bundle them.

Don't forget the stylesheet:

```ts
import '@luhanxin/tiptap-editor/styles.css';
```

## Quick start

### Standalone (non-collaborative) mode

```tsx
import {DocumentEditor} from '@luhanxin/tiptap-editor';
import '@luhanxin/tiptap-editor/styles.css';

function MyDocumentPage() {
  return (
    <DocumentEditor
      editable
      content={initialProseMirrorJson}
      uploadImage={file => uploadToMyBackend(file)}
      onSave={json => saveToMyBackend(json)}
    />
  );
}
```

`editable` and `uploadImage` are the only required props. Everything else — video upload, link preview fetching, autosave cadence, fullscreen — is opt-in; omit it and the corresponding feature silently degrades without breaking the core editing experience.

### Real-time collaborative mode

```tsx
import {DocumentEditor, Y_XML_FRAGMENT_FIELD} from '@luhanxin/tiptap-editor';
import * as Y from 'yjs';
import {WebsocketProvider} from 'y-websocket';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider('wss://your-collab-server', roomName, ydoc);

function CollaborativeDocumentPage() {
  return (
    <DocumentEditor
      editable
      uploadImage={file => uploadToMyBackend(file)}
      collaboration={{
        document: ydoc,
        provider,
        user: {name: currentUser.name, color: currentUser.color}
      }}
      collaborationStatus={status} // 'connecting' | 'synced' | 'disconnected'
      onReconnect={() => provider.connect()}
    />
  );
}
```

Passing `collaboration` switches the source of truth for both title and body content to the shared `Y.Doc` (body lives under the field name exported as `Y_XML_FRAGMENT_FIELD`). `content`, `onSave`, and `autosaveDelay` are ignored in this mode — the CRDT *is* the persistence layer, and it's entirely up to you (and your backend) to persist `Y.Doc` state. The component never creates or destroys the `Y.Doc`/provider itself; their lifecycle is fully owned by the caller.

## Validating content on the server (`./schema` subpath)

The editor's schema is also exported as a Node.js-safe, browser-API-free subpath — useful for validating incoming ProseMirror JSON against the exact same schema the editor produces, so the client can never "type something the server rejects":

```ts
import {documentEditorExtensions} from '@luhanxin/tiptap-editor/schema';
import {getSchema} from '@tiptap/core';

const schema = getSchema(documentEditorExtensions);
// use `schema` with `@tiptap/core`/`prosemirror-model` on the server to validate/parse a document
```

## API reference

| Export | Description |
| --- | --- |
| `DocumentEditor` | The main editor component. See [Quick start](#quick-start) for props. |
| `DocumentOutline` | Standalone heading-based table of contents component. |
| `documentEditorExtensions` | The full Tiptap extension list (schema-level only, no node views) — also available browser-free via `./schema`. |
| `Y_XML_FRAGMENT_FIELD` | The `Y.Doc` field name used for the document body's shared `XmlFragment`. |
| Types | `DocumentEditorProps`, `SaveStatus`, `CollaborationConfig`, `CollaborationProvider`, `CollaborationStatus`, `CollaborationUser`, `CollaboratorInfo`, `HistoricalEditorInfo`, `LinkPreviewResult`, `VideoStatusResult`, `VideoUploadResult` |

### Subpaths

| Subpath | Purpose |
| --- | --- |
| `@luhanxin/tiptap-editor` | Full React component + collaboration types (browser). |
| `@luhanxin/tiptap-editor/schema` | Schema-only, no React/DOM dependency — safe for Node.js server-side validation. |
| `@luhanxin/tiptap-editor/styles.css` | Required stylesheet (not injected automatically — `sideEffects: false`). |

## Docs

Source, issues and the rest of the monorepo live at <https://github.com/lhx-space/infra-docs/tree/main/packages/tiptap-editor>.

## License

MIT © luhanxin
