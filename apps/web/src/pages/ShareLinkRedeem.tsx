import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {EmptyState} from '@/components/shared/EmptyState';
import {Button} from '@/components/ui/button';
import {ApiError} from '@/network';
import {useWikiStore} from '@/store/wiki';

/**
 * Wiki 分享链接兑换页：跟 `InviteRedeem.tsx` 是同一个模式，挂在需要登录的路由分组下，
 * 未登录会先被 `RequireAuth` 重定向去 `/login`。
 */
export default function ShareLinkRedeem() {
  const {token} = useParams<{token: string}>();
  const navigate = useNavigate();
  const redeemShareLink = useWikiStore(state => state.redeemShareLink);

  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    redeemShareLink(token)
      .then(wikiId => {
        setState('success');
        setTimeout(() => navigate(`/wiki/${wikiId}`, {replace: true}), 1200);
      })
      .catch(err => {
        setState('error');
        if (err instanceof ApiError) {
          if (err.message === 'link_expired') setMessage('分享链接已过期或已失效');
          else if (err.message === 'not_team_member')
            setMessage('需要先加入对应团队才能使用这个链接');
          else if (err.message === 'not_found') setMessage('分享链接不存在');
          else setMessage('加入失败，请稍后重试');
        } else {
          setMessage('加入失败，请稍后重试');
        }
      });
  }, [token, redeemShareLink, navigate]);

  if (state === 'loading') {
    return <EmptyState title="正在加入工作区..." description="请稍候" />;
  }
  if (state === 'success') {
    return <EmptyState title="加入成功" description="即将跳转到工作区" />;
  }
  return (
    <EmptyState
      title="加入失败"
      description={message}
      action={<Button onClick={() => navigate('/wiki')}>返回首页</Button>}
    />
  );
}
