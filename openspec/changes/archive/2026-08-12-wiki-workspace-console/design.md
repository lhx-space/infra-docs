## Context

后端 `wiki-workspace-api` 的 CRUD + 角色权限已经跑通（`requireWikiRole` 中间件、`WikiMember` 表），前端只剩 `EmptyState` 壳子。这次要把两块新东西一起接进来：

1. 项目里目前**完全没有文件上传能力**——`apps/api` 没有 `multer`/任何对象存储 SDK，`docker-compose.yml` 只有 `postgres`/`redis`；用户默认头像走的是 DiceBear 生成 URL（`services/auth.ts` 的 `buildDefaultAvatarUrl`），不涉及真实文件上传，这次是第一次要处理"用户上传一张图片、存起来、给个能访问的 URL"这个问题
2. 添加 Wiki 成员现有接口只接受精确 `userId`（`design.md` 决策 4，当时刻意收窄范围），前端需要一个"输入用户名/邮箱找到人"的入口才能把这个功能用起来

## Goals / Non-Goals

**Goals：**
- 评估并落地一个足够简单、本地自建、不依赖第三方云服务账号的图片上传方案
- Wiki 列表页支持创建、Card 展示（含封面图）、hover 设置入口、Pin
- 设置面板支持 Basic Information（改名/简介/封面/删除）、Members（查找添加/改角色/移除，即分享权限管控）
- 前端组件不直接 import services，遵循既有约定（走 store）

**Non-Goals：**
- 不做通用的"文件管理系统"（多文件、文件夹、权限继承）——只解决"上传一张图片、拿到 URL"这一个具体问题
- 不做模糊搜索/用户名录——`user-lookup` 只做精确匹配
- 不做邀请链接/邮件邀请（`wiki-workspace-api` 已经定过这条边界，这轮不推翻）
- 不做图片裁剪/编辑器——前端只提供文件选择，不提供裁剪框/滤镜之类的交互；后端会做格式转换（见决策 9），但不做智能裁剪、不生成多种尺寸的缩略图
- `WikiDetail.tsx`（文章列表）不在这轮范围内

## Decisions

**1. 文件存储用 MinIO，而不是本地磁盘或直接上云**

评估了三个选项：

| 方案 | 说明 | 结论 |
|---|---|---|
| 本地磁盘 + Express 静态文件服务 | 最简单，不需要额外服务 | **不采用**：跟 `apps/api` 进程绑死，以后要是多开一个 API 实例（水平扩展）就会出现"文件存在这台机器上、请求打到另一台机器读不到"的问题；备份/迁移也麻烦（文件散落在容器文件系统里，容器重建就没了，除非单独挂 volume——而这本质上就是在自己实现一个简化版的对象存储） |
| 直接接 AWS S3 / 阿里云 OSS 等云对象存储 | 生产环境标准做法 | **暂不采用**：需要真实云账号、AK/SK，本地开发/自托管场景多一道注册配置的门槛，跟这个项目目前"docker-compose 一把拉起所有依赖"的开发体验不符 |
| **MinIO（自建，S3 协议兼容）** | 用容器跑一个本地对象存储，API 跟 S3 完全兼容 | **采用**：`docker-compose up` 就能起，本地开发零额外账号配置；因为协议跟 S3 兼容，以后真要上生产环境换成 AWS S3/阿里云 OSS，**只需要换连接配置（endpoint/密钥），业务代码不用改**——这是选 MinIO 而不是随便传个本地磁盘方案的核心理由：现在图省事，但没有牺牲"以后能无痛切换到真云存储"这条路 |

`docker-compose.yml` 新增：
```yaml
minio:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
  ports:
    - '9000:9000'   # S3 API
    - '9001:9001'   # 管理控制台
  volumes:
    - ./.data/minio:/data
  healthcheck: ...
```

**2. 用官方 `minio` npm SDK，不用 `@aws-sdk/client-s3`**

`@aws-sdk/client-s3` 功能更全但是给"真的对接 AWS"设计的，配置项（region、签名版本等）里有不少跟 MinIO 无关的噪音；`minio` 官方 JS SDK 是专门为 MinIO 设计的，API 更直接（`client.putObject(bucket, key, buffer)`），依赖体积也更小。因为业务只需要"传一个 buffer、拿到能访问的 URL"这么简单的操作，不需要 S3 协议的全部能力，选轻量的专用 SDK。

**3. 上传接口设计：通用图片上传，不是"Wiki 专属"接口**

`POST /uploads/images`（`multer` 内存存储解析 `multipart/form-data`，字段名 `file`）→ 校验 MIME 类型（仅 `image/*`）+ 大小上限（5MB）→ 写入 MinIO 固定的 `covers` bucket → 返回 `{ url }`。

不做成 `/wikis/:wikiId/cover` 这种绑定 Wiki 的路径，因为"上传一张图片"这个能力跟 Wiki 没有本质关联（以后 Document 封面、用户自定义头像上传大概率也要用同一个接口）——这也是为什么这次单独列成 `file-upload` capability，不并进 `wiki-workspace-console`。

挂载 `requireAuth`（登录用户才能传图），不做"这张图归谁"的所有权记录——当前唯一用途是"生成一个 URL 填进 Wiki.coverImage"，上传接口本身只管"存下来给个 URL"，不管这个 URL 之后被谁引用、引用几次，符合 Non-Goals 里"不做通用文件管理系统"的边界。

**4. Bucket 权限设为公开只读（public-read），不做签名 URL**

上传写入需要鉴权（走 `requireAuth`），但**读取**（前端 `<img src>` 直接展示封面图）不应该要求带 token——图片是公开展示在 Card 上的，不是私密文件。签名 URL（presigned URL）方案会引入"URL 有效期、过期后要不要刷新"的复杂度，对当前场景（公开展示的封面图）没有必要，直接把 bucket policy 设成 public-read，返回的 URL 永久有效。

**5. `Wiki.coverImage` 为空时的兜底：生成默认封面，不强制上传**

跟用户默认头像（`buildDefaultAvatarUrl`）同样的思路——创建 Wiki 时如果没有上传封面图，用 DiceBear 的另一种风格（如 `shapes` 系列）按 Wiki 名称生成一个确定性的默认封面 URL，不需要真实文件上传也能立刻有视觉效果。这个默认封面**不占用 MinIO 存储**（还是外部 DiceBear URL，跟真实上传的图片走的是两条不同路径），只有用户主动上传时才真正经过 MinIO。

**6. `user-lookup` 复用登录时"email/username"的判断方式**

`GET /users/lookup?identifier=`：`identifier` 含 `@` 走 `findUserByEmail`，否则走 `findUserByUsername`，跟 `services/auth.ts` 的 `login()` 完全一致的判断逻辑，直接复用现有 model 函数。找不到返回 `404 user_not_found`，找到返回精简的公开信息（`id/username/avatarUrl`，不返回 email，避免"添加成员"这个功能被拿去当邮箱查找器）。仅挂 `requireAuth`，不做角色限制（任何登录用户都能查，因为这是"添加成员"流程的前置步骤，真正的写权限校验在 `POST /wikis/:wikiId/members` 那一步，`requireWikiRole('OWNER')` 已经卡住了）。

**7. Sidebar Pin 列表改名展示：复用 `store/wiki.ts` 的列表缓存，不新开一次请求**

Sidebar 目前独立于 `WikiList` 页面，如果各自发一次 `GET /wikis` 请求，同样的数据会被拉两次。`store/wiki.ts` 的 Wiki 列表作为一个全局 store（跟 `useProfileStore` 同样的模式），`Sidebar` 和 `WikiList` 都从这个 store 读，`Sidebar` 挂载时如果 store 里还没有数据才触发一次拉取，避免重复请求。Pin 的 id → 名称解析：`pinnedWikiIds.map(id => wikis.find(w => w.id === id)?.name ?? id)`，找不到（如数据还没加载完/已被删除）时兜底显示原始 id，不阻塞渲染。

**8. 设置面板按角色动态禁用操作，前端做的是"体验层"校验，不是安全边界**

面板里的按钮是否可点，根据 `GET /wikis/:wikiId` 返回的 `role` 字段（已有实现）算出来——`VIEWER` 看不到"删除"/"改角色"按钮，`EDITOR` 看不到"删除"/"成员管理"按钮。**这只是不让用户点了看到"操作失败"的糟糕体验**，真正的权限边界始终在后端 `requireWikiRole` 中间件，前端隐藏按钮不能替代、也不改变后端已有的校验逻辑。

**9. 上传时统一转码成 WebP，并限制最大边长**

上传的原始图片（JPEG/PNG/GIF 等）在写入 MinIO 之前，用 `sharp`（Node 生态标准的图片处理库，基于 libvips，处理速度快）统一转成 WebP 格式再存储：

- **为什么转码**：WebP 在同等画质下通常比 JPEG/PNG 小 25%~35%，直接减少 MinIO 存储占用和前端加载图片的流量/耗时；现代浏览器（Chrome/Firefox/Safari 14+/Edge）都原生支持，没有兼容性顾虑
- **顺带限制最大边长**（如最长边不超过 1600px，等比缩放）：封面图只用于卡片展示，用户上传一张 4000×3000 的原图完全没必要按原尺寸存，白白浪费存储和带宽——这一步和格式转换用的是同一次 `sharp` 处理，不是额外成本
- **转码发生在后端**（`multer` 拿到原始 buffer → `sharp` 转码 → 转码后的 buffer 才写入 MinIO），前端不需要做任何格式判断，上传什么格式的图都行，落地的永远是 `.webp`
- **动图的处理边界**：如果用户上传 GIF 动图，`sharp` 默认只会取第一帧转成静态 WebP（不保留动画）——封面图场景不需要动图效果，这个简化是合理的，不额外处理动态 WebP 编码（那样处理链路更复杂，收益不成比例）
- **备选方案**：不转码，原样存储用户上传的格式——实现更简单，但放弃了明显的存储/带宽收益，且不同用户上传的格式五花八门（HEIC/BMP/TIFF 等），前端展示兜底逻辑要考虑更多格式兼容问题，统一转码反而让下游消费方（`<img>` 标签）处理起来更简单

## Risks / Trade-offs

- **[风险] MinIO 是新增的基础设施依赖**，本地开发环境要多起一个容器，`docker-compose.yml` 复杂度增加 → **缓解**：MinIO 镜像轻量、启动快，且这是"以后能换真云存储"这条路径上最低成本的选择，权衡后仍然值得
- **[风险] public-read bucket 意味着任何人拿到 URL 都能看图片**（没有访问控制） → **缓解**：当前场景（Wiki 封面图）本身就是要公开展示的内容，不是敏感数据；如果以后有需要私密存储的场景（比如加密文档附件），需要单独开一个 change 引入签名 URL 方案，不能跟这次的 public bucket 混用同一个 bucket
- **[风险] `user-lookup` 精确匹配 email/username 存在被用来"探测某个邮箱是否注册过"的枚举风险**（虽然登录接口已经有同样的模式，这不是新引入的问题，但范围从"登录报错"扩大到"任何登录用户都能主动查询任意 identifier"） → **缓解**：接口只返回"存在/不存在"和公开信息（不返回敏感字段），跟"能不能登录成功"泄露的信息量级相当，且已挂生产环境限流（复用现有 `loginRateLimiter` 同类思路，若发现被滥用可后续单独加限流）
- **[权衡] 默认封面不真实上传到 MinIO**，意味着"用户拥有的图片"和"外部生成的占位图"是两种不同的 URL 来源 → 这是刻意的简化（同头像默认值的先例），不引入额外存储成本，认为收益大于"两种 URL 来源不统一"这点代码上的不一致
- **[风险] 统一转码成 WebP 会产生一次额外的 CPU 处理**（每次上传都要跑一次 `sharp` 转码+缩放） → **缓解**：`sharp` 底层是 libvips，处理几 MB 的图片通常是几十毫秒级别，量级远小于网络上传本身的耗时，不会成为瓶颈；上传频率也低（创建/修改 Wiki 才会触发，不是高频路径）
