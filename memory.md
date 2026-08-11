# Tiptap 深度介绍

## 一、它是什么

**Tiptap** 是一个基于 [ProseMirror](https://prosemirror.net/)（一个非常底层、久经考验的富文本编辑内核）封装的**无头（Headless）富文本编辑器框架**，由德国团队 überdosis 开发和维护。

关键词理解：
- **无头（Headless）**：Tiptap 本身**不提供任何默认 UI**（没有现成的工具栏、气泡菜单样式），它只负责"编辑内核"（内容模型、光标、输入规则、命令系统等），UI 完全由你自己用 React/Vue/Vanilla JS 搭建。这带来了极高的定制自由度，代价是需要自己写一些界面代码。
- **基于 ProseMirror**：ProseMirror 提供了严格的文档 Schema（结构化的 JSON 文档模型，不是简单的 HTML 字符串）、事务（Transaction）机制、插件系统。Tiptap 把这些底层 API 包装成了更友好、更"声明式"的接口，大幅降低了上手门槛。

一句话总结：**Tiptap = ProseMirror 的"人性化"封装 + 插件化的扩展体系（Extension）+ 官方维护的一整套周边能力（协同、AI、评论等）**。

---

## 二、核心能力

### 1. 扩展系统（Extension）—— 最核心的设计
Tiptap 的一切功能（包括粗体、标题、列表）都是以 **Extension** 的形式提供的，你按需组合：

```ts
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const editor = new Editor({
  element: document.querySelector('.editor'),
  extensions: [StarterKit], // 内置了段落/标题/粗体/斜体/列表/代码块等常用扩展
  content: '<p>Hello World!</p>',
})
```

官方及社区提供 100+ 扩展，覆盖：
- **基础格式**：粗体、斜体、下划线、删除线、高亮、字体颜色/背景色
- **结构化内容**：标题、列表（有序/无序/任务列表）、引用、代码块（支持语法高亮）、表格、分割线
- **媒体**：图片、视频、可拖拽调整大小的图片
- **交互增强**：`@` 提及（Mention）、表情、链接自动识别、占位符（Placeholder）
- **高级输入**：Markdown 快捷输入规则（如输入 `**text**` 自动转粗体）、斜杠命令（`/` 呼出菜单，Notion 风格）
- 你也可以**完全自定义扩展**，定义自己的 Node/Mark/Plugin，实现业务专属的内容类型（比如自定义"待办卡片""流程图节点"等）。

### 2. 框架无关 + 官方多框架绑定
核心是纯 JS，官方提供了对主流框架的绑定：
- `@tiptap/react`（`useEditor` hook）
- `@tiptap/vue-3`
- 也可用于纯 Vanilla JS / Svelte（社区绑定）

这对你的项目很友好，因为可以在不同的 apps（web、desktop 的 Electron 渲染层等）中复用同一套编辑逻辑。

### 3. 结构化文档模型（JSON），而非脆弱的 HTML 字符串
Tiptap/ProseMirror 内部维护的是严格 Schema 约束的 JSON 文档树，比如：

```json
{
  "type": "doc",
  "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }
  ]
}
```

- 可以随时 `editor.getJSON()` / `editor.getHTML()` / `editor.getText()` 导出。
- 结构化数据意味着更容易做校验、序列化、版本迁移，比直接操作 `contenteditable` 的 HTML 靠谱得多。

### 4. 丰富的命令（Command）与 API
所有编辑操作都通过链式命令完成，语义清晰：

```ts
editor.chain().focus().toggleBold().run()
editor.commands.insertContent('<p>New content</p>')
editor.isActive('bold') // 判断当前选区是否为粗体，用于工具栏按钮高亮
```

### 5. 协同编辑（Collaboration）—— 与你的 yjs-docs 项目直接相关
Tiptap 官方提供 `@tiptap/extension-collaboration`，底层通过 `y-prosemirror` 把编辑器状态直接映射为 **Yjs 的 CRDT 数据结构**：

```ts
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'

const ydoc = new Y.Doc()
const editor = new Editor({
  extensions: [
    StarterKit.configure({ history: false }), // 协同模式下需关闭默认 history，交给 Yjs 管理
    Collaboration.configure({ document: ydoc }),
  ],
})
```
- 只需接一个 Yjs Provider（`y-websocket` / `y-webrtc` / 自建的持久化后端），即可实现多人实时协同、离线同步、自动冲突合并。
- 搭配 `@tiptap/extension-collaboration-caret` 可以显示协作者的光标位置和用户名颜色（类似 Google Docs）。

这正是你后期打算给 yjs-docs 引入 Yjs 时，**成本最低、生态最成熟**的路线。

### 6. 商业化生态（Tiptap Pro / Cloud / Content AI）
除了开源核心（MIT 协议免费），官方还提供付费增值服务：

| 产品 | 能力 |
|---|---|
| **Tiptap Cloud** | 托管的协同服务器 + 文档持久化，省去自建 WebSocket 服务器和数据库 |
| **Comments** | 类 Google Docs 的行内评论、批注系统 |
| **Version History / Snapshot** | 文档历史版本回溯 |
| **Content AI** | 集成 OpenAI 等模型，实现 AI 续写、润色、翻译、总结等能力，开箱即用的 AI 扩展 |
| **导入导出** | Word/DOCX 互转、PDF 导出等 |

（这些是可选付费能力，核心编辑器和协同扩展本身是开源免费的，自建 WebSocket 服务器也完全可行，不依赖 Tiptap Cloud。）

### 7. 输入规则与快捷键系统
- **InputRules**：正则匹配自动转换，比如 `# ` 自动变成一级标题，`- ` 变成列表项，这是实现 Markdown 风格快速输入体验的基础。
- **Keymap**：灵活绑定快捷键（Ctrl/Cmd+B 加粗等），可自定义覆盖。

### 8. Node Views —— 用框架组件渲染编辑器内容
可以用 React/Vue 组件直接渲染某个 Node（比如一个可交互的图片裁剪组件、内嵌的图表、Mention 弹出卡片），编辑器内容和你的组件生态无缝结合，这是很多其他编辑器不具备的能力。

---

## 三、优势总结

| 维度 | 说明 |
|---|---|
| **可定制性** | 无头架构 + 插件化，UI 和功能都可以完全按需定制 |
| **文档模型健壮** | 基于 ProseMirror 的 Schema 约束，比 contenteditable 直接操作 DOM 稳定得多 |
| **协同生态成熟** | 官方深度整合 Yjs，是目前做协同文档最靠谱的选择之一 |
| **社区/文档活跃** | GitHub star 数高、更新频繁、示例和文档齐全，中文文档也有（tiptap.zhcndoc.com） |
| **框架无关** | React/Vue/纯 JS 均可用，适合 monorepo 多端复用 |

## 四、需要注意的点（劣势/门槛）

- **无头架构意味着零 UI**：需要自己实现工具栏、气泡菜单、斜杠命令菜单等交互界面，前期开发量比"开箱即用"型编辑器（如 CKEditor）大。
- **学习曲线**：要理解 ProseMirror 的 Schema/Node/Mark/Transaction 概念，尤其做自定义扩展时。
- **部分高级能力收费**：评论、版本历史、AI 等属于 Pro/Cloud 增值服务（但核心编辑+协同是免费开源的）。
- **性能**：大文档（比如几万字+复杂嵌套结构）需要注意渲染优化，通常配合虚拟化或分页处理。

---

## 五、结合你项目的建议

考虑到你（1）已经在做 `apps/web` + `apps/desktop`（Electron）的多端应用，（2）项目名 `yjs-docs` 暗示后续要接 Yjs 协同：

1. 现阶段可以先用 `@tiptap/react` + `StarterKit` 快速搭一个基础编辑器（工具栏自己写，Tiptap 只提供 headless 逻辑）。
2. 后期接入协同时，只需加装 `@tiptap/extension-collaboration` + `yjs` + `y-websocket`（或自建同步服务），几乎不需要重构已有编辑器代码。
3. React 和 Electron 渲染进程（本质也是 Chromium + React）可以共享同一套 Tiptap 编辑器封装组件，减少重复开发。

需要我现在就在 `apps/web` 里搭一个 Tiptap 基础编辑器的 Demo 吗？

---

坦白说，之前的介绍偏"是什么 + 能力清单"，确实还有几个**从工程实践角度很重要、但没展开**的点，尤其是考虑到你们要把它封装成 `packages/` 下的独立包给多端复用。补充如下：

## 之前没提到、但很重要的点

### 1. Tiptap 2 → 3 的版本选择
Tiptap 已经出到 **v3**（v2 仍在维护但新特性都在 v3）。v3 相对 v2：
- 包结构有调整（部分包合并/重命名）
- 对协同（Collaboration）、性能优化做了改进
- 建议新项目直接从 **v3** 起步，避免以后升级迁移成本。

### 2. SSR / Next.js 场景的坑
如果 `apps/web` 涉及 SSR（Next.js 等），Tiptap 编辑器初始化必须处理**服务端和客户端渲染内容不一致**的问题（`immediatelyRender: false` 这个配置是必踩的坑，否则会报 hydration mismatch）。纯 SPA（Vite）项目则不用担心。

### 3. 富文本内容的安全性（XSS）
`editor.getHTML()` 导出的 HTML 如果要**渲染回其他地方**（比如只读预览、邮件、导出页面），必须做 sanitize（如 `dompurify`），不能假设内容一定安全——尤其协同场景下内容来自其他用户输入。

### 4. Schema 演进 / 文档迁移策略
这是**长期维护中最容易被忽略但最痛的问题**：
- 你自定义的 Extension（比如自己加的"待办卡片" Node）以后如果改字段结构，已经存量存储的 JSON 文档怎么兼容？
- 建议从一开始就给自定义 Node 设计 **version 字段** 或写迁移函数，否则半年后线上文档打不开是常见事故。

### 5. Undo/Redo 与协同的冲突
用 `@tiptap/extension-collaboration` 时，必须关闭 `StarterKit` 自带的 `history`（普通撤销/重做），改用 `@tiptap/extension-collaboration-history`（基于 Yjs UndoManager），否则多人协同下撤销会撤销别人的操作，这是接入 Yjs 时最容易翻车的一步。

### 6. 大文档性能
超大文档（几万字/几百个节点）时，Tiptap/ProseMirror 全量 diff 渲染可能变慢，需要考虑：
- 分页 / 懒加载
- 减少不必要的 decoration（如实时高亮）
- 避免在 `onUpdate` 回调里做重计算

### 7. Electron 渲染进程的特殊性
你有 `apps/desktop`（Electron），要注意：
- 剪贴板粘贴（图片、富文本）在 Electron 环境下和浏览器行为略有差异，可能需要自己处理 `clipboardData`
- 如果要支持本地文件拖拽插图，需要结合 Electron 的文件系统 API，而不是纯浏览器的 File API

### 8. 移动端 & 输入法（IME）
中文输入法在 `contenteditable` 里的组合输入（拼音候选阶段触发意外的 InputRule）是富文本编辑器的经典坑，需要专门测试中文/日文输入体验。

---

## 关于你打包成 `packages/editor` 的具体建议

1. **暴露 headless API 为主，UI 组件为辅**：核心包只导出 `useEditor` 封装 + 一组预配置的 Extension 集合；工具栏/气泡菜单做成可选的、可替换的子组件，方便 web 端和 Electron 端各自定制外观。
2. **把"业务自定义 Extension"和"通用能力"分层**：比如 `core`（纯 Tiptap 封装）、`extensions-custom`（你们自己的 Node，如待办卡片）、`collab`（Yjs 相关，后续接入时独立引入，不影响不需要协同的场景）。
3. **提前预留协同的接口位**，即使现在不接 Yjs，也把 `document`/`onUpdate`/`provider` 这类 props 设计成可插拔的，避免以后改 API 破坏现有调用方。
4. **版本锁定**：Tiptap 各扩展包版本必须严格对齐（同一 major 版本），建议在这个包的 `package.json` 用 `peerDependencies` + 精确版本范围管理，避免多端各装一份不同版本导致行为不一致。

这些是我认为对你们后续设计这个包最有价值的补充，其余的（能力清单、协同原理、架构对比）之前已经覆盖完整了。如果你现在想先定这个包的目录结构和 API 草案,我可以帮你搭个骨架。

---

这个思路方向是对的（确实要区分环境），但具体做法我不太建议，主要有两个风险点：

## 1. User-Agent 检测本身不够可靠

Electron 渲染进程默认 UA 里确实带 `Electron/x.x.x`，看起来可以用 `navigator.userAgent.includes('Electron')` 判断。但问题是：

- **UA 是可以被覆盖的**，很多 Electron 应用会主动改写 UA（比如做第三方 OAuth 登录时，很多服务会拒绝非标准浏览器 UA，Electron 官方文档也建议用 `app.userAgentFallback` 或 `webContents.setUserAgent()` 伪装成 Chrome），一旦改了，你的判断逻辑就直接失效。
- UA 检测属于"猜测"，不是"确定性判断"。

**更可靠的方式**：在 Electron 的 preload 脚本里，通过 `contextBridge` 主动暴露一个标识：

```ts
// preload.ts
contextBridge.exposeInMainWorld('__PLATFORM__', 'electron')
```

渲染层判断 `window.__PLATFORM__ === 'electron'`，这是应用主动声明的，而不是猜出来的，100% 准确，也不受 UA 怎么改的影响。

## 2. "动态插入可运行时脚本"这个手段本身没必要，而且有代价

如果目的只是"让 Web 和 Electron 环境跑不同的适配代码"，没必要真的用 `<script>` 标签动态注入，原因：

- **CSP 限制**：注入的动态脚本容易被内容安全策略拦截，尤其是 Electron 里通常会收紧 CSP。
- **打包工具的能力其实已经够用**：Vite/Rollup 天然支持 `import()` 动态导入做**代码分割**，效果上就是"运行时按环境加载不同代码"，但是走的是模块系统，有类型检查、有 tree-shaking、可测试，比裸的脚本注入安全和可维护得多：

```ts
const adapter = window.__PLATFORM__ === 'electron'
  ? await import('./adapters/electron-clipboard')
  : await import('./adapters/web-clipboard')
```

## 更推荐的架构：适配器模式（Adapter），而不是让编辑器包自己"判断环境"

具体到你们的场景（剪贴板、文件拖拽这些差异点），更干净的做法是**把环境判断的责任交还给调用方**，编辑器包本身不关心自己跑在哪：

```ts
// packages/editor 只定义接口
interface EditorPlatformAdapter {
  readClipboardImage(): Promise<Blob | null>
  saveFile(data: Blob): Promise<string>
}

// apps/web 传入 web 版实现
// apps/desktop 传入 electron 版实现（内部用 window.__PLATFORM__ 或直接调用 preload 暴露的 API）
createEditor({ adapter: webAdapter })
createEditor({ adapter: electronAdapter })
```

这样带来的好处：
- 编辑器包完全不依赖运行时环境判断，逻辑更纯粹、更好测试（单测时随便 mock 一个 adapter 即可）
- 以后如果多一个环境（比如小程序/移动端 WebView），只需要多写一个 adapter，不用改判断逻辑
- 避免了"猜环境"的不确定性

**结论**：区分环境这个诉求没问题，但建议：① 用 preload 主动暴露标识替代 UA 猜测，② 用适配器模式 + `import()` 动态导入替代裸脚本注入，两者结合会比纯 UA + 脚本注入更稳、更好维护。

---

存储层要解决的核心问题是：**Yjs 的文档状态是二进制的 CRDT 结构，怎么持久化、怎么增量存、怎么让新加入的人快速拉到最新状态**。展开讲：

## 一、Yjs 文档本质上存的是什么

`Y.Doc` 在内存里维护着完整的 CRDT 结构，但对外可以导出成**二进制**：

```js
import * as Y from 'yjs'

const ydoc = new Y.Doc()
// ... 编辑操作 ...

// 导出完整文档的二进制快照（包含所有历史操作压缩后的最终状态）
const fullState = Y.encodeStateAsUpdate(ydoc)

// 导出"从某个历史状态到现在"的增量更新（更小，适合频繁保存）
const stateVector = Y.encodeStateVector(ydoc)
const diffUpdate = Y.encodeStateAsUpdate(ydoc, prevStateVector)
```

存储层要存的就是这个 `Uint8Array` 二进制数据——**不是存 HTML/JSON 文本**，而是存 Yjs 自己的二进制编码格式。

## 二、两种存储粒度，通常结合用

| 方式 | 说明 | 类比 |
|---|---|---|
| **增量更新（Update Log）** | 每次编辑产生一条小的二进制 diff，追加写入 | 类似数据库的 **WAL（预写日志）** 或事件溯源（Event Sourcing） |
| **全量快照（Snapshot）** | 定期把当前完整状态存一份 | 类似数据库的 **checkpoint** |

**为什么要结合**：如果只存增量，文档存活越久、增量条数越多，新客户端加入时要把几千条 diff 全部下载+回放才能还原最新状态，越来越慢。所以生产实践通常是：

1. 编辑过程中持续追加增量 update（写入快，几十 ms 级）
2. 后台定时任务（比如每 N 条更新，或每隔 5 分钟）把当前 `Y.Doc` 状态 `encodeStateAsUpdate` 一次，存成新的"快照"，并清空/归档之前的增量记录
3. 加载文档时：**快照 + 快照之后的增量** 一起回放，而不是从头回放全部历史

## 三、落到具体存储介质

| 介质 | 适用场景 |
|---|---|
| **关系型数据库（Postgres/MySQL）** 的 `bytea`/`blob` 字段 | 中小规模，文档数量不算海量，方便和其他业务表关联（文档元信息、权限） |
| **对象存储（S3/OSS/COS）** | 二进制体积较大、更新不频繁的场景，元数据（文档 ID、版本号、指向的对象 key）存数据库，二进制内容存对象存储 |
| **专用 KV 存储（LevelDB/RocksDB/Redis）** | 官方生态里 `y-leveldb`、`y-redis` 这类 Provider 就是这个思路，读写快，适合做增量日志层 |
| **MongoDB** | 官方有 `y-mongodb-provider`，用文档结构存增量更新数组 + 定期 compact |

## 四、别自己从零造，官方/社区已有现成方案

### 1. `y-websocket` 自带的持久化
```js
import { LeveldbPersistence } from 'y-leveldb'
const persistence = new LeveldbPersistence('./storage-location')
```
适合快速起步，本地/单机场景够用。

### 2. **Hocuspocus**（Tiptap 官方维护的协同后端服务，推荐）
专门为 Tiptap + Yjs 场景设计，内置持久化 Hook，接哪种数据库完全自己定：

```js
import { Server } from '@hocuspocus/server'

const server = Server.configure({
  async onLoadDocument(data) {
    // 从你自己的数据库读出二进制，还原成 Y.Doc
    const savedState = await db.loadDocBinary(data.documentName)
    if (savedState) Y.applyUpdate(data.document, savedState)
    return data.document
  },
  async onStoreDocument(data) {
    // 编辑后触发，存最新状态到你自己的数据库
    const state = Y.encodeStateAsUpdate(data.document)
    await db.saveDocBinary(data.documentName, state)
  },
})
```
这是目前 Tiptap 官方**最推荐**的协同服务器方案，存储逻辑完全可插拔，接哪个数据库你自己决定，不锁死技术栈。

### 3. 客户端本地持久化（离线场景）
如果要支持离线编辑（比如你们的 `apps/desktop` Electron 端断网也能用）：
```js
import { IndexeddbPersistence } from 'y-indexeddb'
const provider = new IndexeddbPersistence('doc-room-name', ydoc)
```
浏览器/Electron 渲染进程本地先存一份到 IndexedDB，联网后再跟服务端同步，这也是 Yjs 相比 OT 在存储层最大的优势——**本地状态和远程状态用的是同一套数据结构，离线合并不需要额外设计**。

## 五、结合你们项目（yjs-docs + monorepo + Electron）的建议

1. **协同服务端**独立成一个 app（比如 `apps/collab-server`），基于 Hocuspocus 搭，负责接 WebSocket + 存储持久化
2. **存储**先用 Postgres 存二进制状态 + 元数据表（文档归属、权限、更新时间），量大了再迁移到对象存储也不迟，不用一开始就上重型方案
3. **Electron 端**用 `y-indexeddb` 做本地离线兜底，联网后自动跟服务端同步（Yjs 的 Provider 机制天然支持"多个 Provider 同时挂在一个 `Y.Doc` 上"，本地+远程可以并存）
4. **版本历史**如果要做"查看历史版本"功能，就是定期存快照这个机制的自然延伸——每份快照本身就是一个可回溯的历史点

要不要我具体展开 Hocuspocus 怎么接入、或者存储表结构怎么设计？
