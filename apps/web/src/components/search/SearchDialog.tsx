import {BookOpen, Pin} from 'lucide-react';
import {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {usePinnedStore} from '@/store/pinned';
import {useWikiStore} from '@/store/wiki';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 全局搜索弹窗：搜索范围是当前用户可访问的全部 Wiki（跨团队，不受当前团队上下文筛选，
 * 遵循 team-switcher 已定的"搜索不受当前团队筛选"规则）。不含文档内容搜索——Document
 * 模型还不存在（见 wiki-integration-gaps design.md 决策 3）。
 *
 * 未输入关键字时展示"已置顶"列表作为快捷入口，而不是伪造一个"最近访问"排序——
 * 时间戳字段现在完全不存在，展示置顶是唯一有真实数据支撑的默认视图。
 */
export function SearchDialog({open, onOpenChange}: SearchDialogProps) {
  const navigate = useNavigate();
  const wikis = useWikiStore(state => state.wikis);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const [keyword, setKeyword] = useState('');

  const trimmedKeyword = keyword.trim().toLowerCase();

  const pinnedWikis = useMemo(
    () => wikis.filter(wiki => pinnedWikiIds.includes(wiki.id)),
    [wikis, pinnedWikiIds]
  );

  const filteredWikis = useMemo(() => {
    if (!trimmedKeyword) return [];
    return wikis.filter(
      wiki =>
        wiki.name.toLowerCase().includes(trimmedKeyword) ||
        (wiki.description?.toLowerCase().includes(trimmedKeyword) ?? false)
    );
  }, [wikis, trimmedKeyword]);

  function handleSelect(wikiId: string): void {
    onOpenChange(false);
    setKeyword('');
    navigate(`/wiki/${wikiId}`);
  }

  function handleOpenChange(next: boolean): void {
    if (!next) setKeyword('');
    onOpenChange(next);
  }

  const showingPinned = trimmedKeyword.length === 0;
  const resultList = showingPinned ? pinnedWikis : filteredWikis;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="搜索 Wiki"
      description="按名称或简介搜索 Wiki，或直接选择已置顶的工作区"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="搜索 Wiki 名称或简介..."
        value={keyword}
        onValueChange={setKeyword}
      />
      <CommandList>
        {resultList.length === 0 ? (
          <CommandEmpty>
            {showingPinned
              ? '暂无置顶内容。当前仅支持按 Wiki 名称/简介搜索'
              : '暂无匹配结果。当前仅支持按 Wiki 名称/简介搜索'}
          </CommandEmpty>
        ) : (
          <CommandGroup heading={showingPinned ? '已置顶' : '搜索结果'}>
            {resultList.map(wiki => (
              <CommandItem
                key={wiki.id}
                value={wiki.id}
                onSelect={() => handleSelect(wiki.id)}
                className="gap-2"
              >
                {showingPinned ? <Pin className="size-4" /> : <BookOpen className="size-4" />}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm">{wiki.name}</span>
                  {wiki.description ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {wiki.description}
                    </span>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
