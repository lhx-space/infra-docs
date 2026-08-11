import {type SubmitEvent, useState} from 'react';
import {Link} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {useAuthStore} from '@/store/auth';

export default function Login() {
  const login = useAuthStore(state => state.login);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!identifier.trim() || !password) {
      setError('请输入账号和密码');
      return;
    }

    setIsSubmitting(true);
    try {
      // 登录成功后不需要手动 navigate('/')：status 变为 authenticated 后，
      // 包裹这个页面的 RequireGuest 会声明式地重定向到主页——"登录后去哪"这个决策
      // 只应该有一处（RequireGuest），这里手动 navigate 会变成第二份重复实现。
      await login(identifier.trim(), password);
    } catch (err) {
      // store 的 login action 已经把错误翻译成友好文案（见 store/auth.ts 的 toFriendlyError），
      // 这里直接读 err.message 即可，不需要认识 ApiError/错误码字典
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">登录到账号</CardTitle>
        <CardDescription>使用邮箱或用户名和密码登录你的账号</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="identifier">邮箱或用户名</Label>
            <Input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              placeholder="you@example.com"
              value={identifier}
              onChange={event => setIdentifier(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={event => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? '登录中...' : '登录'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          还没有账号？{' '}
          <Link
            to="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            去注册
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
