## Requirements

### Requirement: Home 展示置顶 Wiki（跨团队）
Home 页面 SHALL 展示当前用户已置顶的全部 Wiki，不受当前团队上下文筛选（跨团队展示），与 Sidebar/Wiki 列表页的置顶展示范围保持一致；没有任何置顶时该分区 MUST 不展示。

#### Scenario: 展示跨团队的置顶 Wiki
- **WHEN** 用户置顶了归属不同团队的多个 Wiki
- **THEN** Home 页面的置顶分区同时展示这些 Wiki，不受当前团队限制

#### Scenario: 没有置顶时不展示该分区
- **WHEN** 用户没有置顶任何 Wiki
- **THEN** Home 页面不展示置顶分区

### Requirement: Home 展示当前团队的 Wiki 快捷入口
Home 页面 SHALL 展示归属当前团队上下文的 Wiki 列表（Card 形式，复用 Wiki 列表页的卡片组件）；当前团队下没有 Wiki 时展示引导创建的空态。

#### Scenario: 展示当前团队的 Wiki
- **WHEN** 当前团队下存在至少一个 Wiki
- **THEN** Home 页面展示这些 Wiki 的卡片网格

#### Scenario: 当前团队没有 Wiki 时的引导空态
- **WHEN** 当前团队下没有任何 Wiki
- **THEN** Home 页面展示引导创建 Wiki 的空态提示，而非空白页面
