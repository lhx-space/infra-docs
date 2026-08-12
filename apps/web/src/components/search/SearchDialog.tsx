import {BookOpen, FileText, Pin} from 'lucide-react';
import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import type {Document} from '@/services/document';
import {usePinnedStore} from '@/store/pinned';
import * as searchStore from '@/store/search';
import type {Wiki} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 全局搜索弹窗：搜索范围是当前用户可访问的全部 Wiki 与 Document（跨团队，不受当前团队上下文
 * 筛选，见 wiki-search spec.md）。有输入关键字时才调用后端 `GET /search`，未输入时展示已置顶
 * Wiki 列表——Document 数据量级不再适合"全量拉到前端内存里过滤"（见 design.md 决策 9）。
 */
export function SearchDialog({open, onOpenChange}: SearchDialogProps) {
  const navigate = useNavigate();
  const wikis = useWikiStore(state => state.wikis);
  const pinnedWikiIds = usePinnedStore(state => state.pinnedWikiIds);
  const [keyword, setKeyword] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{wikis: Wiki[]; documents: Document[]}>({
    wikis: [],
    documents: []
  });

  const trimmedKeyword = keyword.trim();

  const pinnedWikis = useMemo(
    () => wikis.filter(wiki => pinnedWikiIds.includes(wiki.id)),
    [wikis, pinnedWikiIds]
  );

  useEffect(() => {
    if (!trimmedKeyword) {
      setResults({wikis: [], documents: []});
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchStore
        .search(trimmedKeyword)
        .then(res => {
          if (!cancelled) setResults(res);
        })
        .catch(() => {
          if (!cancelled) setResults({wikis: [], documents: []});
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedKeyword]);

  function handleSelectWiki(wikiId: string): void {
    onOpenChange(false);
    setKeyword('');
    navigate(`/wiki/${wikiId}`);
  }

  function handleSelectDocument(doc: Document): void {
    onOpenChange(false);
    setKeyword('');
    navigate(`/wiki/${doc.wikiId}/documents/${doc.id}`);
  }

  function handleOpenChange(next: boolean): void {
    if (!next) setKeyword('');
    onOpenChange(next);
  }

  const showingPinned = trimmedKeyword.length === 0;
  const hasResults = results.wikis.length > 0 || results.documents.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="搜索"
      description="按名称/简介搜索 Wiki，或按标题/正文搜索文档，也可以直接选择已置顶的工作区"
      shouldFilter={false}
    >
      <CommandInput placeholder="搜索 Wiki 或文档..." value={keyword} onValueChange={setKeyword} />
      <CommandList>
        {showingPinned ? (
          pinnedWikis.length === 0 ? (
            <CommandEmpty>
              暂无置顶内容。可以输入关键字搜索 Wiki 名称/简介或文档标题/正文
            </CommandEmpty>
          ) : (
            <CommandGroup heading="已置顶">
              {pinnedWikis.map(wiki => (
                <CommandItem
                  key={wiki.id}
                  value={wiki.id}
                  onSelect={() => handleSelectWiki(wiki.id)}
                  className="gap-2"
                >
                  <Pin className="size-4" />
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
          )
        ) : searching ? (
          <CommandEmpty>搜索中...</CommandEmpty>
        ) : !hasResults ? (
          <CommandEmpty>暂无匹配结果</CommandEmpty>
        ) : (
          <>
            {results.wikis.length > 0 ? (
              <CommandGroup heading="Wiki">
                {results.wikis.map(wiki => (
                  <CommandItem
                    key={wiki.id}
                    value={`wiki-${wiki.id}`}
                    onSelect={() => handleSelectWiki(wiki.id)}
                    className="gap-2"
                  >
                    <BookOpen className="size-4" />
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
            ) : null}
            {results.documents.length > 0 ? (
              <CommandGroup heading="文档">
                {results.documents.map(doc => (
                  <CommandItem
                    key={doc.id}
                    value={`document-${doc.id}`}
                    onSelect={() => handleSelectDocument(doc)}
                    className="gap-2"
                  >
                    <FileText className="size-4" />
                    <span className="truncate text-sm">{doc.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
