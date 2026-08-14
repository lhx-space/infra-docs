import {z} from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /** gRPC server 监听端口（见 yjs-realtime-collaboration design.md 决策 10）：与 HTTP
   * server 完全独立的监听端口，`apps/collab-server`（Rust）作为客户端调用这个地址。
   * 默认值特意不用 4001——实测在 macOS 上会跟 QQ 桌面客户端自己占用的 `127.0.0.1:4001`
   * 撞车（QQ 绑的是精确地址，比这里绑的通配地址 `*:4001` 更精确，会被系统优先路由，
   * 导致 collab-server 的 gRPC 调用连上 QQ 而不是这个服务，报 `transport error`，
   * 现象跟"服务没启动"完全一样，容易误判，见 system-performance-hardening 相关排查）。 */
  GRPC_PORT: z.coerce.number().int().positive().default(4011),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  JWT_SECRET: z.string(),
  REFRESH_TOKEN_SECRET: z.string(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  /** 前端页面 origin，用于 CORS 白名单 + 携带凭证（refresh cookie） */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** MinIO 内部连接地址（SDK 读写用），与 MINIO_PUBLIC_URL 分开，见 design.md 决策 1 */
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ROOT_USER: z.string().default('minioadmin'),
  MINIO_ROOT_PASSWORD: z.string().default('minioadmin'),
  /** 拼接公开可访问 URL 用的外部地址，生产环境换真云存储时只需要改这一个值 */
  MINIO_PUBLIC_URL: z.string().default('http://localhost:9000')
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
