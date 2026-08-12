import {useEffect, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {EmptyState} from '@/components/shared/EmptyState';
import {Button} from '@/components/ui/button';
import {ApiError} from '@/network';
import {useTeamStore} from '@/store/team';

/**
 * 邀请链接兑换页：这个路由挂在需要登录的路由分组下（见 router/routes.tsx），未登录会先被
 * `RequireAuth` 重定向去 `/login`（跟点开其他任何受保护链接一致，不额外做"登录后自动回跳"
 * 这套单独的机制，避免为这一个场景引入新的路由基础设施）。
 */
export default function InviteRedeem() {
  const {token} = useParams<{token: string}>();
  const navigate = useNavigate();
  const redeemInvite = useTeamStore(state => state.redeemInvite);

  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    redeemInvite(token)
      .then(teamId => {
        setState('success');
        setTimeout(() => navigate(`/teams/${teamId}/wikis`, {replace: true}), 1200);
      })
      .catch(err => {
        setState('error');
        if (err instanceof ApiError) {
          if (err.message === 'invite_expired') setMessage('邀请链接已过期或已失效');
          else if (err.message === 'invite_exhausted') setMessage('邀请链接已达使用次数上限');
          else if (err.message === 'not_found') setMessage('邀请链接不存在');
          else setMessage('加入失败，请稍后重试');
        } else {
          setMessage('加入失败，请稍后重试');
        }
      });
  }, [token, redeemInvite, navigate]);

  if (state === 'loading') {
    return <EmptyState title="正在加入团队..." description="请稍候" />;
  }
  if (state === 'success') {
    return <EmptyState title="加入成功" description="即将跳转到团队工作区" />;
  }
  return (
    <EmptyState
      title="加入失败"
      description={message}
      action={<Button onClick={() => navigate('/wiki')}>返回首页</Button>}
    />
  );
}
