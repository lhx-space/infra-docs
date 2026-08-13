import {type NodeViewProps, NodeViewWrapper} from '@tiptap/react';
import {useEffect, useRef, useState} from 'react';
import {getActiveVideoStatusPoller} from '../utils/video/video-status-registry';

/** 轮询间隔：转码通常是秒级到分钟级，这个量级下体验完全可接受（见 design.md 决策 3） */
const POLL_INTERVAL_MS = 3000;
/** 播放中鼠标静止超过这个时长后自动隐藏控制条，跟主流播放器（YouTube/B站）体感一致 */
const CONTROLS_AUTO_HIDE_MS = 2500;

/** hls.js 里我们实际用到的最小接口，见下方动态 import 处的说明 */
interface MinimalHlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  destroy(): void;
}
interface MinimalHlsStatic {
  isSupported(): boolean;
  new (): MinimalHlsInstance;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 自定义控制条用的几个小图标：直接内联 SVG path，不引入图标库依赖（跟封面播放按钮
 * 用纯 CSS 三角形是同一个取向，只是这几个形状用 CSS 画不划算，SVG 更简洁） */
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function VolumeOnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 10v4h4l5 5V5L7 10H3z" />
      <path d="M16.5 12c0-1.77-.94-3.29-2.5-4.03v8.06c1.56-.74 2.5-2.26 2.5-4.03z" />
    </svg>
  );
}
function VolumeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3 10v4h4l5 5V5L7 10H3z" />
      <path d="M16.5 12l2.5-2.5-1-1L15 11l-2.5-2.5-1 1L14 12l-2.5 2.5 1 1L15 13l2.5 2.5 1-1z" />
    </svg>
  );
}
function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M7 14H5v5h5v-2H7v-3zM5 10h2V7h3V5H5v5zM17 17h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  );
}

/**
 * 视频块的 NodeView（见 document-editor spec.md「视频转码状态反馈」）：`processing`
 * 展示加载占位（转码 worker 会先单独截一帧封面并提前落库，所以 `processing` 阶段往往
 * 已经有 `posterUrl` 可用作背景，不用一直转圈，见 apps/api 侧
 * `jobs/process-video-transcode.ts`「封面优先」注释）；`ready` 时**不会立刻**开始加载
 * 播放流——先展示封面 + 一个播放按钮，用户点击后才真正挂载 `<video>` 并附加
 * `hls.js`（`activated` 状态），避免用户还没打算看这段视频时就产生一次流媒体请求
 * （见 document-editor spec.md「按需加载播放」）；`failed` 展示错误提示。`hls.js` 用
 * 动态 `import()` 而不是模块顶层静态引入——跟 `MermaidView` 对 `mermaid` 的处理是
 * 同一个理由：没有插入任何视频的文档不需要加载这个依赖，且保证 Schema 定义本身
 * （`src/utils/video-node.ts`）不依赖它。
 *
 * 激活后的播放控制条完全是自定义实现（不用浏览器原生 `<video controls>`）：原生控件
 * 在不同浏览器/系统下样式差异很大（Chrome 灰色扁平、Safari 圆润毛玻璃），跟编辑器
 * 其余部分的视觉语言完全脱节，也没法跟随编辑器自己的深浅色主题切换。自定义控制条
 * 只做了播放/暂停、可拖拽进度条 + 时间、静音切换、全屏四个最常用的操作——音量精细
 * 调节、播放速度等更小众的操作没有做，用一个静音按钮已经覆盖"临时消音"这个最高频
 * 场景，不值得为此再画一条音量滑杆增加控制条的视觉复杂度。
 *
 * 轮询 effect 在任何挂载时机都会生效——不区分"刚插入的新节点"还是"重新打开文档时
 * 加载出来的、仍处于 processing 状态的旧节点"，两种场景走的是同一段代码
 * （见 spec.md「重新打开文档时同步最新转码状态」，不需要在 `DocumentEditor` 顶层
 * 单独扫描一遍全部视频节点）。同理，`activated` 每次挂载都从 `false` 开始——重新打开
 * 文档时即使视频早已 `ready`，也还是先展示封面，不会一进文档就悄悄发起流媒体请求。
 */
export function VideoView({node, updateAttributes}: NodeViewProps) {
  const assetId = node.attrs['assetId'] as string | null;
  const hlsUrl = node.attrs['hlsUrl'] as string | null;
  const posterUrl = node.attrs['posterUrl'] as string | null;
  const status = node.attrs['status'] as 'processing' | 'ready' | 'failed';
  const error = node.attrs['error'] as string | null;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activated, setActivated] = useState(false);

  // 自定义控制条需要的播放态，全部从 <video> 原生事件同步过来，不自己维护一份可能
  // 跟真实播放状态脱节的"影子状态"
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `updateAttributes` 每次渲染可能是新引用，但轮询命中后会通过它把 status 改成 ready/failed，effect 因 status 变化重新执行时会走 `status !== 'processing'` 直接短路退出，不需要把它列进依赖
  useEffect(() => {
    if (status !== 'processing' || !assetId) return;
    const poll = getActiveVideoStatusPoller();
    if (!poll) return;
    // 上面两个 guard 已经把 assetId/poll 都排除了 null，但 TS 不会把这个窄化带进下面的
    // 嵌套函数闭包里，单独存两个确认非空的局部变量供 tick() 使用
    const confirmedAssetId = assetId;
    const confirmedPoll = poll;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function schedule(): void {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    function tick(): void {
      confirmedPoll(confirmedAssetId).then(
        result => {
          if (cancelled) return;
          if (result.status === 'processing') {
            schedule();
            return;
          }
          updateAttributes({
            status: result.status,
            hlsUrl: result.hlsUrl ?? null,
            posterUrl: result.posterUrl ?? null,
            error: result.error ?? null
          });
        },
        () => {
          if (!cancelled) schedule();
        }
      );
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status, assetId]);

  // 只有用户点了播放按钮（`activated`）之后才真正开始加载流媒体，见组件顶部注释
  // 「按需加载播放」——`status === 'ready'` 只代表"转码已完成、可以播放了"，不代表
  // "现在就要开始加载"。
  useEffect(() => {
    if (status !== 'ready' || !hlsUrl || !activated) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = hlsUrl;
      videoEl.play().catch(() => {});
      return;
    }

    let cancelled = false;
    let hls: MinimalHlsInstance | null = null;
    // hls.js 1.7.0 打包的 `.d.mts` 类型声明引用了它自己 devDependencies 里的
    // `@svta/cml-cmcd`（未随包发布为可解析的依赖），直接用 `import()` 做类型推导会导致
    // typecheck 报错——这里手动转成一个只包含我们实际用到的几个成员的最小接口，完全
    // 绕开它有问题的类型声明，不影响运行时行为（JS 层该 import 的还是同一个真实模块）。
    void (import('hls.js') as unknown as Promise<{default: MinimalHlsStatic}>).then(
      ({default: Hls}) => {
        if (cancelled || !Hls.isSupported()) return;
        const instance = new Hls();
        instance.loadSource(hlsUrl);
        instance.attachMedia(videoEl);
        // 用户刚点了播放按钮才会走到这里，是一次真实的用户手势触发，这里主动
        // `.play()` 不会被浏览器的自动播放策略拦下；`hls.js` manifest/首个分片还没
        // 加载好时 `.play()` 会短暂 pending，加载完会自然开始播放，不需要额外等事件。
        videoEl.play().catch(() => {});
        hls = instance;
      }
    );

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [status, hlsUrl, activated]);

  // 把 <video> 原生事件同步进自定义控制条需要的状态——播放/暂停/进度/时长/静音/
  // 缓冲中，全部以真实媒体元素状态为准，不猜测
  useEffect(() => {
    if (!activated) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const onTimeUpdate = () => setCurrentTime(videoEl.currentTime);
    const onDurationChange = () => setDuration(videoEl.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolumeChange = () => setMuted(videoEl.muted);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);

    videoEl.addEventListener('timeupdate', onTimeUpdate);
    videoEl.addEventListener('durationchange', onDurationChange);
    videoEl.addEventListener('loadedmetadata', onDurationChange);
    videoEl.addEventListener('play', onPlay);
    videoEl.addEventListener('pause', onPause);
    videoEl.addEventListener('volumechange', onVolumeChange);
    videoEl.addEventListener('waiting', onWaiting);
    videoEl.addEventListener('playing', onPlaying);

    return () => {
      videoEl.removeEventListener('timeupdate', onTimeUpdate);
      videoEl.removeEventListener('durationchange', onDurationChange);
      videoEl.removeEventListener('loadedmetadata', onDurationChange);
      videoEl.removeEventListener('play', onPlay);
      videoEl.removeEventListener('pause', onPause);
      videoEl.removeEventListener('volumechange', onVolumeChange);
      videoEl.removeEventListener('waiting', onWaiting);
      videoEl.removeEventListener('playing', onPlaying);
    };
  }, [activated]);

  function togglePlay(): void {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (videoEl.paused) videoEl.play().catch(() => {});
    else videoEl.pause();
  }

  function toggleMute(): void {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
  }

  function toggleFullscreen(): void {
    const stageEl = stageRef.current;
    if (!stageEl) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageEl.requestFullscreen?.().catch(() => {});
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>): void {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const time = Number(e.target.value);
    videoEl.currentTime = time;
    setCurrentTime(time);
  }

  // 播放中鼠标静止一段时间后自动隐藏控制条；暂停时始终展示（用户大概率正准备操作），
  // 见组件顶部注释「按需加载播放」旁边这一段的整体取向：不打扰用户观看，但操作入口
  // 一直触手可及
  function showControlsTemporarily(): void {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    if (isPlaying) {
      hideControlsTimerRef.current = setTimeout(
        () => setControlsVisible(false),
        CONTROLS_AUTO_HIDE_MS
      );
    }
  }

  function handleStageMouseLeave(): void {
    if (isPlaying) setControlsVisible(false);
  }

  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, []);

  if (status === 'failed') {
    return (
      <NodeViewWrapper
        className="doc-editor-video doc-editor-video--failed"
        contentEditable={false}
      >
        <p className="doc-editor-video__error">{error || '视频处理失败'}</p>
      </NodeViewWrapper>
    );
  }

  if (status === 'processing') {
    return (
      <NodeViewWrapper
        className="doc-editor-video doc-editor-video--processing"
        contentEditable={false}
        style={posterUrl ? {backgroundImage: `url(${posterUrl})`} : undefined}
      >
        <p className="doc-editor-video__placeholder">视频转码中...</p>
      </NodeViewWrapper>
    );
  }

  if (status === 'ready' && !activated) {
    return (
      <NodeViewWrapper
        className="doc-editor-video doc-editor-video--poster"
        contentEditable={false}
      >
        <button
          type="button"
          className="doc-editor-video__play-trigger"
          style={posterUrl ? {backgroundImage: `url(${posterUrl})`} : undefined}
          onClick={() => setActivated(true)}
          aria-label="播放视频"
        >
          <span className="doc-editor-video__play-icon" aria-hidden="true" />
        </button>
      </NodeViewWrapper>
    );
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  // 经典的"输入框自身背景透出"技巧：轨道用 CSS 设成透明，这里在输入框本身画一条
  // 已播放/未播放两段渐变，看起来就像一条有填充效果的进度条，不需要 CSS 自定义属性
  const seekBackground = `linear-gradient(to right, var(--doc-editor-accent) ${progressPercent}%, rgb(255 255 255 / 35%) ${progressPercent}%)`;

  return (
    <NodeViewWrapper className="doc-editor-video doc-editor-video--ready" contentEditable={false}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 这里的鼠标事件只是"移动/离开时展示或隐藏控制条"这个纯视觉便利功能，不承载任何键盘用户必须依赖的操作——控制条里的播放/进度条/静音/全屏按钮各自都是原生可聚焦、可键盘操作的元素，键盘用户完全不需要经过这个 div 就能完成全部操作 */}
      <div
        ref={stageRef}
        className="doc-editor-video__stage"
        onMouseMove={showControlsTemporarily}
        onMouseLeave={handleStageMouseLeave}
        onDoubleClick={toggleFullscreen}
      >
        <video
          ref={videoRef}
          className="doc-editor-video__player"
          preload="auto"
          poster={posterUrl ?? undefined}
          onClick={togglePlay}
        >
          <track kind="captions" />
        </video>

        {isBuffering && <span className="doc-editor-video__spinner" aria-hidden="true" />}

        <div
          className={`doc-editor-video__controls${controlsVisible ? ' doc-editor-video__controls--visible' : ''}`}
        >
          <button
            type="button"
            className="doc-editor-video__ctrl-btn"
            onClick={togglePlay}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="doc-editor-video__time">{formatTime(currentTime)}</span>
          <input
            type="range"
            className="doc-editor-video__seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            style={{background: seekBackground}}
            aria-label="播放进度"
          />
          <span className="doc-editor-video__time">{formatTime(duration)}</span>
          <button
            type="button"
            className="doc-editor-video__ctrl-btn"
            onClick={toggleMute}
            aria-label={muted ? '取消静音' : '静音'}
          >
            {muted ? <VolumeOffIcon /> : <VolumeOnIcon />}
          </button>
          <button
            type="button"
            className="doc-editor-video__ctrl-btn"
            onClick={toggleFullscreen}
            aria-label="全屏"
          >
            <FullscreenIcon />
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
