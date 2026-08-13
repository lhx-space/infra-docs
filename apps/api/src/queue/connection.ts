import IORedis from 'ioredis';
import {env} from '../env';

/**
 * BullMQ 专用的 Redis 连接——跟 `cache/index.ts` 里给 KV 缓存用的那个连接（配置的是
 * `maxRetriesPerRequest: 1`、`enableOfflineQueue: false`，取向是"缓存查询快速失败"）
 * 目标完全不同，不能复用同一个实例。BullMQ 内部依赖阻塞命令轮询队列，要求
 * `maxRetriesPerRequest: null`；这里单独起一个连接，物理上仍连的是同一个 Redis 实例
 * （见 video-hls-embed design.md 决策 1）。
 *
 * **重要（见 upload-reliability-hardening design.md 决策 4，源码级结论，非猜测）**：
 * 这个连接是"外部实例化后传给 BullMQ"的（而不是让 BullMQ 自己用 URL/options new 出来
 * 一个），BullMQ 会把它标记成 `shared: true`——`Queue`/`Worker` 的 `.close()` 对它是
 * **空操作**，不会真正调用底层的 `disconnect()`/`quit()`（见
 * `node_modules/bullmq/dist/cjs/classes/redis-connection.js` 第 506 行
 * `if (!this.extraOptions.shared) { ...才真的断开... }`，以及
 * `node_modules/bullmq/dist/cjs/utils/create-backend.js` 第 42 行
 * `shared: isRedisInstance(opts.connection)`）。这不是 bug——`server.ts`/`worker.ts`
 * 两个长跑进程本来就是靠显式 `process.exit()` 收尾，不依赖这条连接被"真正"关掉；但
 * 如果你在写一个**一次性调试/运维脚本**（比如临时查一下队列的 active/waiting 计数），
 * 脚本跑完 JS 逻辑后 `await someQueue.close()` **不会**让这条 socket 断开，Node
 * 事件循环会因为还有这个活跃的 socket handle 而永远不自然退出——这正是我们排查
 * "一次性脚本卡住不退出"时发现的真实教训，脚本收尾请调用下面的
 * `disconnectSharedQueueConnection()`，不要指望某个 Queue/Worker 的 `.close()`。
 */
export const queueConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

/**
 * 供一次性调试/运维脚本收尾时调用，真正断开 `queueConnection` 这条底层 socket
 * （直接调用 `.quit()`，不经过任何 Queue/Worker 的 `.close()`，见上方注释）。
 *
 * `server.ts`/`worker.ts` 这两个长跑进程 **不需要也不应该** 调用它——它们的
 * `process.exit()` 已经是正确的收尾方式；如果长跑进程也调用了这个方法，会在
 * "多个 Queue/Worker 共享同一个连接对象"的场景下，把还在被其他代码使用的连接提前
 * 掐断。
 */
export function disconnectSharedQueueConnection(): Promise<void> {
  return queueConnection.quit().then(() => undefined);
}
