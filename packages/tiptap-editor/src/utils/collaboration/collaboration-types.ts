import type {Awareness} from 'y-protocols/awareness';
import type * as Y from 'yjs';

/**
 * 消费方（`apps/web`）创建并持有生命周期的协同连接配置，组件本身不感知具体的
 * provider 实现（不绑定 Hocuspocus，见 yjs-realtime-collaboration design.md 决策 8），
 * 只要求暴露标准的 `awareness`——标准 `y-websocket` 的 `WebsocketProvider` 天然满足
 * 这个形状，跟现有"消费方注入 uploadImage/fetchLinkPreview 具体实现"是同一种模式。
 */
export interface CollaborationProvider {
  awareness: Awareness;
}

export interface CollaborationUser {
  name: string;
  color: string;
  /** 真实头像图 URL（如 DiceBear 生成的默认头像/用户自己上传的头像）；不传或加载失败
   * 时退回用 `name` 首字母的纯色圆圈兜底（跟 `apps/web` 的 `UserAvatar` 组件是同一套
   * 兜底逻辑，这里独立实现一份是因为本包不能依赖 apps/web 的组件） */
  avatarUrl?: string | null;
}

export interface CollaborationConfig {
  /** 已初始化的 Yjs 文档，由消费方创建/持有生命周期，本组件不负责销毁它 */
  document: Y.Doc;
  provider: CollaborationProvider;
  /** 当前用户在协作者光标/在线列表上展示的信息 */
  user: CollaborationUser;
}

/**
 * 跟 document-editor spec.md 修改后的「自动保存与状态反馈」需求对应：协同模式下
 * 展示的是同步连接状态，不是某一次离散保存请求的成败。由消费方监听 provider 的
 * 连接/同步事件后通过 `collaborationStatus` prop 传入——组件本身不创建/管理
 * provider，因此也不能自己判断这个状态（见决策 8）。
 */
export type CollaborationStatus = 'connecting' | 'synced' | 'disconnected';

export interface CollaboratorInfo {
  clientId: number;
  name: string;
  color: string;
  avatarUrl?: string | null;
}

/**
 * 历史编辑人（曾经编辑过这篇文档，不要求当前在线，见 `DocumentEditor` 的
 * `historicalEditors` prop）：跟 `CollaboratorInfo` 的关键区别是没有 `clientId`
 * ——那是 awareness 里临时会话的标识，历史编辑人是持久化的用户身份，用 `id`
 * （用户 id）标识、渲染时也拿它做 React key。
 */
export interface HistoricalEditorInfo {
  id: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
}

/**
 * `Y.Doc` 里存放正文内容的 `XmlFragment` 字段名，必须跟 `apps/api`
 * `services/yjs-content.ts` 的 `Y_XML_FRAGMENT_FIELD` 完全一致——两侧各自读写的是
 * 同一个 `Y.Doc` 里同名的 `XmlFragment`，任何一侧改了名字而另一侧没同步改，就会读到
 * 一个空文档。不依赖 `@tiptap/extension-collaboration`/`y-prosemirror` 的隐式默认值
 * （两者默认值恰好也是 `'default'`，但显式声明避免"两处隐式约定恰好一致"这种脆弱耦合）。
 */
export const Y_XML_FRAGMENT_FIELD = 'default';
