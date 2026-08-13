/**
 * 全包共享的"当前有多少个上传请求正在进行中"计数器（见 upload-reliability-hardening
 * design.md 决策 3）：图片/视频的上传请求已经发出、但结果尚未插入编辑器内容这段窗口内
 * 计数 `> 0`，供 `DocumentEditor.tsx` 决定是否需要在这段时间内挂 `beforeunload` 提示。
 *
 * 不区分"是图片还是视频"——`beforeunload` 只关心"现在有没有东西正在丢失风险窗口内"，
 * 不需要按类型分开计数；`video-uploader-registry.ts`/`image-uploader-registry.ts` 各自
 * 导出的 `begin*Upload()`/`end*Upload()` 只是这个共享计数器的类型化外壳，方便调用点读起
 * 来能看出"这是哪种上传"，实际计数逻辑只有这一份，不会重复实现、不会两边计数不一致。
 *
 * 用一个简单的模块级计数 + 订阅者集合，不引入状态管理库——这个模块只服务
 * `DocumentEditor` 内部这一个消费场景，不需要更重的方案。
 */
let pendingCount = 0;
const listeners = new Set<(count: number) => void>();

function notify(): void {
  for (const listener of listeners) listener(pendingCount);
}

export function beginPendingUpload(): void {
  pendingCount += 1;
  notify();
}

/** `finally` 里调用，保证上传成功/失败/异常三条路径都会正确清零，不会卡在 `> 0` 上 */
export function endPendingUpload(): void {
  pendingCount = Math.max(0, pendingCount - 1);
  notify();
}

export function getPendingUploadCount(): number {
  return pendingCount;
}

/** 返回取消订阅函数；订阅时不会立即回调一次当前值，调用方需要的话自己先读一次
 * `getPendingUploadCount()` */
export function subscribePendingUploadCount(listener: (count: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
