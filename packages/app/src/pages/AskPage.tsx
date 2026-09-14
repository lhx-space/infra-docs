import {AIChatPanel} from '@luhanxin/ai-chat';
import {PageHeader} from '@/components/shell/PageHeaderContext';

/**
 * 全局 AI 问答页（见 ai-assistant design.md）：RAG 知识库问答，独立于文档编辑器。
 * 以当前用户可访问的全部文档为语料，答案带引用来源。与编辑器旁的「AI 写作」是
 * 两个不同场景——写作控制当前文档，问答面向整个知识库。
 */
export default function AskPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="AI 问答" />
      <div className="min-h-0 flex-1">
        <AIChatPanel mode="ask" />
      </div>
    </div>
  );
}
