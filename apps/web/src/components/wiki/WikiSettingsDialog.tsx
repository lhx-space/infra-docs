import {useEffect, useState} from 'react';
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {cn} from '@/lib/utils';
import type {Wiki, WikiRole} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';
import {WikiBasicInfoTab} from './WikiBasicInfoTab';
import {WikiMembersTab} from './WikiMembersTab';

interface WikiSettingsDialogProps {
  wiki: Wiki | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabKey = 'basic' | 'members';

const TABS: Array<{key: TabKey; label: string}> = [
  {key: 'basic', label: 'Basic Information'},
  {key: 'members', label: 'Members'}
];

/**
 * 设置面板：Dialog + 两个 Tab，接收 wikiId 和当前用户角色（打开时通过 GET /wikis/:wikiId 拿角色，
 * 见 design.md 决策 8——按钮可用状态统一由角色计算，不在每个子组件里各自判断一遍）。
 */
export function WikiSettingsDialog({wiki, open, onOpenChange}: WikiSettingsDialogProps) {
  const getWiki = useWikiStore(state => state.getWiki);
  const [role, setRole] = useState<WikiRole | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('basic');

  useEffect(() => {
    if (!open || !wiki) {
      setRole(null);
      return;
    }
    setActiveTab('basic');
    getWiki(wiki.id)
      .then(res => setRole(res.role))
      .catch(() => setRole(null));
  }, [open, wiki, getWiki]);

  if (!wiki) return null;

  const canEditBasicInfo = role === 'OWNER' || role === 'EDITOR';
  const canManageMembers = role === 'OWNER';
  const canDelete = role === 'OWNER';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="truncate">{wiki.name} · 设置</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent hover:text-foreground'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {role === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">加载中...</p>
        ) : activeTab === 'basic' ? (
          <WikiBasicInfoTab
            wiki={wiki}
            canEdit={canEditBasicInfo}
            canDelete={canDelete}
            onDeleted={() => onOpenChange(false)}
            onTransferred={() => onOpenChange(false)}
          />
        ) : (
          <WikiMembersTab wiki={wiki} canManage={canManageMembers} currentRole={role} />
        )}
      </DialogContent>
    </Dialog>
  );
}
