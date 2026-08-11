## Context

`GET /me`（`api-auth-middleware` change）目前的实现是 `findUserById` + `toPublicUser`，只查 `User` 表。`prisma/schema.prisma` 里 `UserProfile` 是与 `User` 一对一的表（`nickname`/`avatarUrl`/`bio`/`gender`/`birthday`/`phone`），`models/user.ts` 里已经有现成的 `findUserWithProfile(id)` 可以直接查出关联数据，无需新的 Prisma 查询。

前端 `components/shell/UserMenu.tsx` 现在展示的用户详情（点击头像后的菜单顶部）只有 `username`/`email`，这两个字段来自登录/刷新接口返回的 `AuthUser`，从未调用过 `/me`。

## Goals / Non-Goals

**Goals:**
- `/me` 响应新增 `profile` 字段，只暴露对用户菜单展示有意义的三个字段（`nickname`/`avatarUrl`/`bio`），没有 profile 记录时返回 `null` 而不是报错
- 前端在 `UserMenu` 挂载时静默拉取一次 `/me`，用返回的 `profile` 数据丰富详情区展示，请求失败时优雅降级（保留现有 username/email 展示，不报错、不阻塞交互）
- 头像展示优先使用真实 `avatarUrl`（如果有），否则回退到现有的确定性生成头像

**Non-Goals:**
- 不做"编辑资料"功能（改昵称、传头像、写简介）——本次只做只读展示，写入能力留给后续单独的 change
- 不暴露 `gender`/`birthday`/`phone`——这些字段更敏感，且当前用户菜单的展示场景不需要，按最小暴露原则不返回
- 不改变 `/me` 现有的鉴权/401 契约，`requireAuth` 中间件本身不动

## Decisions

**1. `/me` 用 `findUserWithProfile` 替换 `findUserById`，新增 `services/user.ts` 承载"组装 /me 响应"的逻辑**
- `findUserWithProfile` 已经存在于 `models/user.ts`，直接换查询函数即可，不需要写新的 Prisma query
- 新增 `services/user.ts` 里的 `getMe(userId)`，返回 `{ user: PublicUser, profile: PublicProfile | null }`，把"如何从 `UserProfile` 收窄成公开字段"这件事从 handler 里拆出来，跟 `services/auth.ts` 里 `toPublicUser` 是同一种模式（一个 `toPublicProfile` 映射函数）
- 备选方案：继续在 handler 里直接组装——`api-auth-middleware` 的 design.md 当时的决策 4 是"目前只有一个查自己的需求，不用建 service 层"，但现在多了一层数据收窄逻辑（挑字段、处理 null profile），值得单独放到 service 里，避免 handler 变厚，不采用继续堆在 handler 里的做法

**2. `profile` 收窄字段：只保留 `nickname`/`avatarUrl`/`bio`，其余字段一律不返回**
- `gender`/`birthday`/`phone` 属于更私密的个人信息，当前唯一的消费场景（用户菜单详情区）根本不需要这些字段，遵循最小暴露原则不返回
- 备选方案：整个 `UserProfile` 原样返回——省事，但把不必要的隱私字段暴露给前端（哪怕前端不用），未来如果要做"分享给他人查看的公开资料页"，最好从一开始就区分清楚"哪些字段允许对外暴露"，不采用

**3. 前端拉取时机：挂载时立即拉取（不是点开菜单才拉取），结果存局部 `useState`，不进 `store/auth.ts` 全局状态**
- 头像本身是**常驻可见的 UI**（页面右上角一直露出来），不是"点开才看到"的内容，业务上理应尽快就位，因此挂载时机必须是 mount，不能延迟到用户点击——业务时机的设计不应该被"如何避免重复请求"这类工程细节反向牵着走
- 挂载时机带来的"`StrictMode` 开发环境下 effect 双调用导致重复请求"问题，交给 `services/user.ts` 里 `getMe()` 内部的 `dedupe()` 去重解决（见决策 4.1），而不是靠改变触发时机或加 ref 强行"守住只发一次"——两次调用天然会共享同一个 in-flight Promise，只发一次真实网络请求
- `useEffect` 依赖项用 `user?.id` 而不是 `user` 对象引用——后台定时静默刷新 token（`store/auth.ts` 的 `scheduleBackgroundRefresh`）每次都会产生一个内容相同但引用不同的新 `user` 对象，若依赖整个 `user` 对象会导致每次刷新都重新拉一次 `/me`，只有"登录的人真的变了"才需要重新请求
- effect 内用一个局部 `ignore` 标记（React 官方推荐的"在 effect 中请求数据"写法）：组件卸载或 `user?.id` 变化时，忽略旧请求的迟到结果，避免用旧数据覆盖新状态；这解决的是"正确性"问题，跟"要不要重复发请求"是两件事，不能互相替代
- `profile` 数据目前只有这一个消费场景（用户菜单详情区），不需要提升到全局 store——遵循 YAGNI，等未来出现第二个消费场景（比如个人主页）再考虑要不要挪到 store 或做缓存
- 备选方案 A：改成点开菜单时才拉取——错误地把"头像常驻可见"和"详情文字点开才看到"两种不同性质的展示需求混为一谈，会导致头像有一瞬间显示的是占位图而不是真实头像，体验倒退，不采用
- 备选方案 B：用 `useRef` 一次性 guard 强行拦掉第二次 effect 调用——治标不治本，且这类"防重复"逻辑本该在更通用的资源层（`dedupe`）解决一次，不应该在每个用到请求的组件里各自重复实现一遍，不采用
- 备选方案 C：塞进 `store/auth.ts`，跟 `user`/`accessToken` 放一起——会让本来已经"变薄"的 auth store 又开始承担跟鉴权无关的资料展示状态，且当前只有一处用到，不采用

**4. 请求失败静默降级，不重试、不报错**
- `getMe()` 失败（网络问题、服务暂时不可用）时，`UserMenu` 只是保持 `profile` 为 `null`，详情区退回到"只有 username/email"的现状展示，不弹错误提示、不阻塞菜单打开——这是一个纯粹的锦上添花的展示增强，失败了不应该影响核心的"查看资料/切换主题/退出登录"操作
- 备选方案：失败后重试或展示错误态——对于这种非关键的展示增强，增加复杂度换不来对应的用户价值，不采用

**4.1 请求去重（Singleflight）下沉到传输层，业务层不用自己记得调用**
- `lib/request-dedupe.ts` 提供通用的 `dedupe(key, factory)`：同一个 `key` 在结果落地前的并发调用全部复用同一个 in-flight Promise，落地后立即清除缓存——不是缓存结果，只是合并同一时刻的并发调用
- **不在业务层（`services/user.ts` 的 `getMe()`）手动调用 `dedupe`，而是内置进 `lib/http.ts` 的 `http.get`**：所有 `GET` 请求自动按 `path` 去重，这是对"GET 天然幂等、结果理应共享"这一 HTTP 语义的统一兜底，靠传输层强制保证，而不是靠每个调用方自觉记得包一层——避免"这次记得加、下次某个新接口忘了加"的系统性风险
- `POST`/`PUT`/`DELETE` 等有副作用的请求不做这个默认行为：`lib/http.ts` 的 `refreshAccessToken` 出于 token rotation 的特殊原因（并发刷新会导致旧 token 被吊销后失败）显式调用 `dedupe('auth:refresh', ...)`，这是一个刻意保留的、有文档说明的例外，不是常态
- 适用边界：只适合"幂等、无副作用、多消费者拿到的结果理应一致"的请求；不适合"后来者应该取消前者"的场景（如搜索框输入联想），那种场景应该用 `AbortController` 主动取消，两者不能叠加在同一个请求实例上（取消会连带杀死其他共享方还在等的结果）
- 备选方案：在每个业务 service 函数里各自手动调用 `dedupe`——`getMe()` 最初就是这么做的，但这只解决了"这一个函数"的问题，下一个新增的 GET 请求函数如果忘了包一层，同样的重复请求问题会再犯一次；下沉到传输层之后，这类保护对所有 GET 请求"免费生效"，不采用手动挂载的方式

**4.2 "过期请求结果不覆盖最新状态"的竞态防护，抽成通用 hook `hooks/use-fetch-effect.ts`，不在每个组件里手写**
- `useFetchEffect(fetcher, onData, deps, enabled)` 封装了 React 官方推荐的"在 effect 里发请求"模式（`ignore` 标记 + cleanup），组件只需要声明"何时请求、请求什么、拿到结果后做什么"，不需要重复手写竞态防护的样板代码
- 这与 4.1 是两个不同层级的问题：4.1 解决"要不要真的发起网络请求"（去重/合并），4.2 解决"请求发出去之后，结果要不要生效"（竞态）——两者分别在传输层和 UI 层各自解决一次，`UserMenu.tsx` 本身只保留业务语义（依赖 `user?.id`、拿到 `profile` 后 `setProfile`）
- 备选方案：继续在 `UserMenu.tsx` 里手写 `let ignore = false`——当前只有一处用到看不出问题，但下一个组件要做类似的事情时会重新抄一遍这段样板代码，属于本可以一次性解决却分散在各处反复实现的系统性缺口，不采用

**5. `lib/avatar.ts` 的 `getAvatarUrl` 增加可选的 `avatarUrl` 参数，有则优先用**
- 签名从 `getAvatarUrl(user: Pick<AuthUser, 'username'>)` 变为 `getAvatarUrl(user: Pick<AuthUser, 'username'>, avatarUrl?: string | null)`，`avatarUrl` 有值时直接返回它，否则走原来的 DiceBear 生成逻辑——这正是此前 `home-workspace-shell` change 里设计注释预留的判断分支
- 调用方（`UserMenu.tsx` 内的 `UserAvatar`）从 `profile?.avatarUrl` 读取并传入

## Risks / Trade-offs

- [Risk] `UserMenu` 挂载时机跟"用户是否已登录"耦合——如果 `user` 还没 ready（如 `initAuth` 尚未完成）就调用 `/me`，会拿到一次多余的 401 → Mitigation：`UserMenu` 本身已经有 `if (!user) return null` 的判断，`useEffect` 里同样以 `user` 存在为前提才触发请求，避免在未登录状态下发请求
- [Trade-off] `profile` 状态放在组件局部而不是全局 store，意味着如果未来其他地方也要用这份数据，需要重新发一次请求——当前只有一个消费场景，用局部状态换取更简单的代码结构，属于合理的当下取舍，后续可以再重构
- [Risk] 如果用户在另一个标签页/设备上更新了资料（未来功能），当前标签页的 `profile` 不会自动感知变化，只有整个应用重新挂载（刷新页面）才会重新拉取 → Mitigation：本次是只读展示、没有编辑入口，暂不存在这种"跨标签页数据不同步"的实际场景；等做编辑功能时再一起设计刷新策略
