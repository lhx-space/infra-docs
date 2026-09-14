## Purpose

编辑器旁的 AI 聊天面板（飞书式 Copilot 侧边栏）能力：在文档编辑视图提供一个可切换「写作 / 问答」两种模式的面板，写作模式下用自然语言控制当前文档的书写，结果以「生成 → 审阅 → 应用到编辑器」的方式同步进 `Y.Doc`；输出通过 SSE 流式返回；模型可按配置路由到 OpenAI / Anthropic / DeepSeek / 本地 Ollama；访问需登录鉴权，写作受文档写权限约束。该能力由 `apps/ai-server`（Rust + Rig）+ `packages/ai-chat`（前端面板）+ `packages/tiptap-editor` 暴露的编辑器桥共同提供。

## Requirements

### Requirement: 聊天面板的展示与模式切换
文档编辑视图 SHALL 提供一个与编辑器并排的 AI 聊天面板，包含消息列表与输入框；面板 SHALL 提供「写作」与「问答」两个显式模式供用户切换，进入面板时默认选中一种模式；关闭/收起面板 MUST 不中断已进行的流式生成（若生成仍在进行，可选择取消）。

#### Scenario: 打开聊天面板
- **WHEN** 用户在文档编辑视图中打开 AI 聊天面板
- **THEN** 面板在编辑器旁展示，显示欢迎语/模式切换与输入框

#### Scenario: 切换写作与问答模式
- **WHEN** 用户在写作与问答模式之间切换
- **THEN** 输入框与后续请求按所选模式路由到对应的处理能力（写作 agent 或 RAG agent）

### Requirement: 写作模式通过自然语言控制文档书写
写作模式下，用户输入自然语言指令后，系统 SHALL 调用写作 agent，基于「当前文档标题 + 上下文切片（选区/光标附近）+ 指令」生成内容；生成结果 MUST 先以流式文案展示在面板中，MUST NOT 自动写入文档正文。

#### Scenario: 生成一段内容
- **WHEN** 用户在写作模式输入「帮我写一段关于 X 的介绍」并发送
- **THEN** 面板流式展示生成的内容，文档正文保持不变

#### Scenario: 基于选区润色/翻译
- **WHEN** 用户在文档中选中一段文字，并在写作模式输入「把这段翻译成英文」
- **THEN** agent 基于选中文字生成翻译结果，流式展示在面板中，选中内容保持不变

### Requirement: 生成结果应用到编辑器
面板流式生成完成后，系统 SHALL 提供「插入 / 替换」等应用操作；用户触发应用后，系统 MUST 通过 `DocumentEditor` 暴露的编辑器桥调用 Tiptap 命令，把生成内容写入 `Y.Doc`，并随实时协同连接同步给其他在线协作者；应用失败（如失去编辑权限）时 MUST 给出可读错误，且不产生半成品内容。

#### Scenario: 应用插入到光标处
- **WHEN** 用户在流式生成完成后点击「插入」
- **THEN** 生成内容插入到当前光标位置，并同步给同一文档的其他在线协作者

#### Scenario: 应用替换选中文字
- **WHEN** 用户此前选中了文字、生成的是针对该选区的改写，点击「替换」
- **THEN** 原选中文字被生成内容替换，并同步给其他在线协作者

#### Scenario: 失去编辑权限时应用失败
- **WHEN** 用户角色已降级为 `VIEWER`（或已无编辑权限），却尝试应用生成内容
- **THEN** 应用被拒绝并提示无编辑权限，文档内容不受影响

### Requirement: 写作权限约束
写作模式下的「应用到编辑器」SHALL 要求当前用户在目标文档所属 Wiki 的角色为 `EDITOR` 及以上（含 Team OWNER 兜底权限，复用现有角色体系）；`VIEWER` 只能查看面板与发起请求，但不能把结果应用到文档；服务端 MUST 在校验通过后才接受请求（权限判断复用 `apps/api` 的既有实现，不在 `ai-server` 重复实现）。

#### Scenario: VIEWER 无法应用生成结果
- **WHEN** 角色为 `VIEWER` 的用户在写作模式生成内容后尝试应用
- **THEN** 应用入口不可用或被服务端拒绝，文档内容不受影响

#### Scenario: EDITOR 正常应用
- **WHEN** 角色为 `EDITOR` 或 `OWNER` 的用户应用生成内容
- **THEN** 应用成功并同步给其他在线协作者

### Requirement: SSE 流式输出
聊天面板发起 AI 请求后，系统 SHALL 通过 SSE 流式返回生成内容，用户无需等待完整结果即可看到逐段输出；流式过程中连接中断或出错时 MUST 给出可读提示，并允许用户重试。

#### Scenario: 流式展示生成内容
- **WHEN** 用户发送一条 AI 请求
- **THEN** 面板边生成边展示内容，而不是等待完整结果一次性出现

#### Scenario: 流式中断提示
- **WHEN** 流式输出过程中网络中断或服务端出错
- **THEN** 面板提示生成中断并允许重试，已展示的部分内容保留

### Requirement: 模型路由
`ai-server` SHALL 支持通过配置把模型请求路由到 OpenAI / Anthropic / DeepSeek / 本地 Ollama 四类 provider 之一；provider 的选择与模型名 MUST 由服务端配置决定（不在前端硬编码）；切换 provider MUST 不需要改动前端代码。

#### Scenario: 配置切换 provider
- **WHEN** 运维将 `ai-server` 的 provider 配置从 OpenAI 切换为 Ollama（本地）
- **THEN** 后续 AI 请求由新 provider 处理，前端无需任何改动

### Requirement: 登录鉴权
AI 请求 SHALL 要求登录：客户端 MUST 携带有效的 access token，`ai-server` 本地校验 token 签名与过期（复用共享的 `JWT_SECRET`，与 `collab-server` 一致）；未携带或 token 无效时 MUST 拒绝请求。

#### Scenario: 未登录请求被拒绝
- **WHEN** 未登录（无有效 token）的客户端发起 AI 请求
- **THEN** 请求被拒绝，不返回任何生成内容

#### Scenario: 有效 token 正常请求
- **WHEN** 已登录用户发起 AI 请求且 token 有效
- **THEN** 请求正常处理，内容流式返回

### Requirement: 会话管理与长上下文
聊天面板 SHALL 支持多轮对话：系统 SHALL 为一次对话维持一个会话（`sessionId`），客户端只持久化 `sessionId` 并随请求携带，服务端持有会话历史；当会话历史超过上下文预算时，系统 SHALL 通过「滚动关键要点摘要 + 滑动窗口」控制上下文长度（智能提炼早期历史的关键要点为摘要，而非机械压缩或每轮全量重总结），MUST NOT 因历史过长而超出模型上下文窗口或导致请求失败；会话过期（超出 TTL）后历史被清理，新消息重新开始会话。

#### Scenario: 多轮对话共享上下文
- **WHEN** 用户在同一个会话中连续追问（如先生成一段、再要求「改短一点」）
- **THEN** 后续请求能引用之前的对话内容，服务端按会话历史提供上下文

#### Scenario: 历史过长时提炼关键要点
- **WHEN** 会话历史超出配置的 token 预算
- **THEN** 系统智能提炼早期历史的关键要点为摘要、保留最近若干轮原文，请求仍正常处理，不超上下文窗口，且关键信息不因压缩而丢失

#### Scenario: 会话过期清理
- **WHEN** 一个会话超过 TTL 未被使用
- **THEN** 该会话历史被清理，后续请求按新会话处理

### Requirement: 语音朗读（TTS）
聊天面板中 AI 生成的回答 SHALL 支持语音朗读：用户可对一条回答触发朗读，系统通过 TTS 把文本转为语音并播放；TTS 由 `ai-server` 提供（Rig `audio_generation`，v1 用 OpenAI `tts-1`），模型与音色由服务端配置决定，前端不硬编码。

#### Scenario: 朗读一条回答
- **WHEN** 用户对聊天面板里的一条 AI 回答点击「朗读」
- **THEN** 该回答文本被转为语音并播放，无需刷新或重新生成内容

#### Scenario: TTS 失败提示
- **WHEN** TTS 服务不可用或生成失败
- **THEN** 面板给出可读错误提示，不影响已有的文本回答

### Requirement: 语音输入（STT）
聊天面板 SHALL 支持语音输入：用户点击麦克风录音，系统通过 STT 把语音转成文字，回填到输入框供用户确认后发送（不自动发送）；STT 由 `ai-server` 提供（Rig `transcription`，v1 用 OpenAI `whisper-1`）。

#### Scenario: 录音转文字回填
- **WHEN** 用户点击麦克风并说完一段话
- **THEN** 语音被转成文字回填到输入框，用户可编辑后发送

#### Scenario: STT 失败提示
- **WHEN** STT 服务不可用或转写失败
- **THEN** 面板给出可读错误提示，输入框内容不受影响

### Requirement: 图片理解（vision）
聊天面板 SHALL 支持在消息中附带图片，系统把图片连同文字指令发给 LLM 理解；图片由对话 provider 的视觉能力处理，provider 不支持图片时 SHALL 给出可读错误。

#### Scenario: 附带图片提问
- **WHEN** 用户粘贴/上传一张图片并输入「描述这张图」
- **THEN** LLM 基于图片内容给出描述，回复展示在面板中

#### Scenario: provider 不支持图片
- **WHEN** 当前对话 provider 不支持图片输入
- **THEN** 系统提示「当前模型不支持图片」，不静默丢失图片内容
