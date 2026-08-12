import {useEffect, useState} from 'react';
import {useParams} from 'react-router-dom';
import {EmptyState} from '@/components/shared/EmptyState';
import {useTeamStore} from '@/store/team';
import type {Wiki} from '@/store/wiki';
import {useWikiStore} from '@/store/wiki';

/**
 * Wiki 详情页：目前只是文章列表的占位（专属 Shell 与文章树留给后续 change）。
 *
 * 这里承担的关键职责是"跨团队打开静默跟随切换"——如果通过搜索结果/分享链接/直接访问 URL
 * 打开的这个 Wiki 归属的团队跟 Sidebar 当前选中的团队不一致，静默把 `currentTeamId` 切换
 * 过去，不弹确认提示，保持"感知不到硬切换"的体验（见 team-switcher spec.md「打开跨团队
 * 工作区时静默跟随切换」）。
 */
export default function WikiDetail() {
  const {wikiId} = useParams<{wikiId: string}>();
  const getWiki = useWikiStore(state => state.getWiki);
  const currentTeamId = useTeamStore(state => state.currentTeamId);
  const setCurrentTeamId = useTeamStore(state => state.setCurrentTeamId);

  const [wiki, setWiki] = useState<Wiki | null>(null);

  useEffect(() => {
    if (!wikiId) return;
    getWiki(wikiId)
      .then(res => setWiki(res.wiki))
      .catch(() => setWiki(null));
  }, [wikiId, getWiki]);

  // 只在这个 Wiki 归属的团队跟当前团队不一致时才切换一次，避免每次渲染都触发 set
  // （wiki.teamId 变化才重新执行，正常浏览同一个 Wiki 时不会反复调用）。
  useEffect(() => {
    if (!wiki) return;
    if (wiki.teamId !== currentTeamId) setCurrentTeamId(wiki.teamId);
  }, [wiki, currentTeamId, setCurrentTeamId]);

  return <EmptyState title="暂无文章" description="这个 Wiki 下还没有任何文章" />;
}
