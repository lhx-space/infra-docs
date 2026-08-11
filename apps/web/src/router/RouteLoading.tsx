import {Loader2} from 'lucide-react';

/** 路由懒加载时的过渡态：居中转圈，简单干净 */
export function RouteLoading() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
