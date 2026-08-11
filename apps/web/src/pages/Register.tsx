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

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

export default function Register() {
  const register = useAuthStore(state => state.register);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): string | null {
    if (!/^\S+@\S+\.\S+$/.test(email)) return '请输入合法的邮箱地址';
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      return `用户名长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 位之间`;
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return `密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`;
    }
    return null;
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      // 同 Login.tsx：注册成功后自动登录、status 变为 authenticated，
      // 交给 RequireGuest 声明式重定向，这里不重复决策跳转目标。
      await register(email.trim(), username.trim(), password);
    } catch (err) {
      // store 的 register action 已经把错误翻译成友好文案，这里直接读 err.message 即可
      setError(err instanceof Error ? err.message : '注册失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">创建账号</CardTitle>
        <CardDescription>填写以下信息以创建一个新账号</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={event => setEmail(event.target.value)}
              aria-invalid={Boolean(error)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="your_username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              aria-invalid={Boolean(error)}
            />
            <p className="text-xs text-muted-foreground">
              {USERNAME_MIN}-{USERNAME_MAX} 位字符
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={event => setPassword(event.target.value)}
              aria-invalid={Boolean(error)}
            />
            <p className="text-xs text-muted-foreground">
              {PASSWORD_MIN}-{PASSWORD_MAX} 位字符
            </p>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? '创建中...' : '创建账号'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          已有账号？{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            去登录
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
