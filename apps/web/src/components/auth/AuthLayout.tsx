import type {ReactNode} from 'react';
import heroImage from '@/assets/hero.png';

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * 登录/注册共享布局：桌面端左右分栏（左侧品牌展示 + 右侧表单卡片），
 * 移动端仅保留右侧表单卡片。
 */
export function AuthLayout({children}: AuthLayoutProps) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="relative hidden lg:flex lg:flex-col lg:justify-between lg:p-10">
        <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />

        <div className="relative z-10 flex items-center gap-2 text-lg font-semibold text-white">
          <span className="flex size-8 items-center justify-center rounded-md bg-white/15 text-sm">
            Y
          </span>
          Yjs Docs
        </div>

        <div className="relative z-10 text-white">
          <p className="text-2xl font-medium leading-relaxed">
            实时协作文档编辑，
            <br />
            让团队的想法即刻同步。
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex items-center gap-2 text-lg font-semibold lg:hidden">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm">
            Y
          </span>
          Yjs Docs
        </div>

        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
