import {BookOpen, Pin, Settings} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {usePinnedStore} from '@/store/pinned';
import type {Wiki} from '@/store/wiki';

interface WikiCardProps {
  wiki: Wiki;
  onOpenSettings: (wiki: Wiki) => void;
}

/**
 * Wiki 卡片：点击卡片主体导航到详情页；hover 时显示设置入口和 pin 入口，
 * 两个入口都会 stopPropagation，不触发卡片主体的默认导航（见 spec.md「卡片 Hover 显示设置入口」）。
 *
 * 卡片主体用真正的 <button>（不是 div+role="button"）保证语义化和键盘可达性；
 * 悬浮的操作按钮作为外层 div 的兄弟节点绝对定位，不嵌在主体 button 内部——
 * 避免 button 嵌套 button 这种无效 HTML 结构。
 */
export function WikiCard({wiki, onOpenSettings}: WikiCardProps) {
  const navigate = useNavigate();
  const isPinned = usePinnedStore(state => state.isWikiPinned(wiki.id));
  const togglePinWiki = usePinnedStore(state => state.togglePinWiki);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => navigate(`/wiki/${wiki.id}`)}
        className="flex w-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm outline-none transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="aspect-video w-full overflow-hidden bg-muted">
          {wiki.coverImage ? (
            <img src={wiki.coverImage} alt={wiki.name} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <BookOpen className="size-8 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 p-4">
          <span className="truncate text-sm font-semibold">{wiki.name}</span>
          {wiki.description ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{wiki.description}</span>
          ) : null}
        </div>
      </button>

      <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={isPinned ? '取消置顶' : '置顶'}
          onClick={e => {
            e.stopPropagation();
            togglePinWiki(wiki.id);
          }}
        >
          <Pin className={cn('size-4', isPinned && 'fill-current')} />
        </Button>
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label="Wiki 设置"
          onClick={e => {
            e.stopPropagation();
            onOpenSettings(wiki);
          }}
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </div>
  );
}
