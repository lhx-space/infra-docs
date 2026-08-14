import {dispatchError} from './dispatch';
import type {NetworkConnectionKind} from './types';

/** WebSocket 的正常关闭状态码（RFC 6455）：由消费方主动调用 `close()`（不传参数或
 * 显式传 1000）触发，代表这是一次预期内的关闭，不代表连接失败——见 spec.md「正常关闭
 * 不产生报告」，不应该生成任何报告。 */
const NORMAL_CLOSURE_CODE = 1000;

function labelSuffix(label: string | undefined): string {
  return label ? ` (${label})` : '';
}

function registerWebSocket(
  ws: WebSocket,
  kind: NetworkConnectionKind,
  label: string | undefined
): () => void {
  function handleError(): void {
    // `WebSocket` 的 `error` 事件本身不携带任何可用的错误详情（浏览器出于安全考虑
    // 屏蔽了具体原因），能确定的只有"这个连接出错了"这个事实本身。
    dispatchError({
      source: 'network',
      level: 'error',
      message: `WebSocket 连接错误${labelSuffix(label)}`,
      extra: {kind, label}
    });
  }

  function handleClose(event: CloseEvent): void {
    if (event.code === NORMAL_CLOSURE_CODE) return;
    dispatchError({
      source: 'network',
      level: 'error',
      message: `WebSocket 异常关闭${labelSuffix(label)}（code: ${event.code}）`,
      extra: {kind, label, code: event.code, reason: event.reason}
    });
  }

  ws.addEventListener('error', handleError);
  ws.addEventListener('close', handleClose);

  return () => {
    ws.removeEventListener('error', handleError);
    ws.removeEventListener('close', handleClose);
  };
}

function registerEventSource(
  es: EventSource,
  kind: NetworkConnectionKind,
  label: string | undefined
): () => void {
  function handleError(): void {
    dispatchError({
      source: 'network',
      level: 'error',
      message: `SSE 连接错误${labelSuffix(label)}`,
      extra: {kind, label, readyState: es.readyState}
    });
  }

  es.addEventListener('error', handleError);

  return () => {
    es.removeEventListener('error', handleError);
  };
}

/**
 * 把一个 `WebSocket`/`EventSource` 实例接入 `error-monitor`（见
 * error-monitor-network-support design.md 决策 1、Non-Goals 最后一条：显式注册，不做
 * 自动探测）。只关心连接级失败（建连失败、异常关闭），不采集连接建立成功后的单条
 * 消息级错误，也不做 HTTP 请求/状态码统计——继续维持跟 APM 的边界。
 *
 * 返回一个注销函数：调用后停止监听这个实例产生的后续错误/关闭（这个实例本身不受
 * 影响），未注册的实例完全不受影响（见 spec.md「未注册的连接不产生报告」）。
 *
 * 消费方在重连场景下需要注意：像 `y-websocket` 的 `WebsocketProvider` 每次重连都会
 * 创建一个全新的原生 `WebSocket` 实例（`.ws` 属性会变化），本函数只认传入的这一个
 * 具体实例，不会追踪封装对象后续的重连——旧实例销毁前调用这里返回的注销函数，拿到
 * 新实例后重新调用 `registerNetworkConnection` 即可（见 design.md「Open Questions」）。
 */
export function registerNetworkConnection(
  connection: WebSocket | EventSource,
  kind: NetworkConnectionKind,
  label?: string
): () => void {
  if (kind === 'websocket') return registerWebSocket(connection as WebSocket, kind, label);
  return registerEventSource(connection as EventSource, kind, label);
}
