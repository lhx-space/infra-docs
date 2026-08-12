import {type CSSProperties, useState} from 'react';
import {reportError} from '../core/report-error';

const FAB_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  zIndex: 2147483647,
  width: 40,
  height: 40,
  borderRadius: '9999px',
  border: 'none',
  background: '#18181b',
  color: '#f4f4f5',
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(0,0,0,.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const PANEL_STYLE: CSSProperties = {
  position: 'fixed',
  bottom: 64,
  right: 16,
  zIndex: 2147483647,
  width: 220,
  padding: 12,
  borderRadius: 10,
  background: '#18181b',
  color: '#f4f4f5',
  boxShadow: '0 4px 18px rgba(0,0,0,.4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
};

const TITLE_STYLE: CSSProperties = {
  margin: '0 0 4px',
  fontWeight: 700,
  color: '#a1a1aa'
};

const BTN_STYLE: CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #3f3f46',
  background: '#27272a',
  color: '#f4f4f5',
  cursor: 'pointer',
  fontSize: 12,
  textAlign: 'left'
};

export interface ErrorMonitorDevToolsProps {
  enabled?: boolean;
}

export function ErrorMonitorDevTools({enabled = true}: ErrorMonitorDevToolsProps) {
  const [open, setOpen] = useState(false);
  const [throwOnRender, setThrowOnRender] = useState(false);

  if (!enabled) return null;

  if (throwOnRender) {
    throw new Error('[error-monitor devtools] 手动触发的 render 错误');
  }

  return (
    <>
      <button
        type="button"
        style={FAB_STYLE}
        onClick={() => setOpen(v => !v)}
        title="error-monitor devtools"
        aria-label="error-monitor devtools"
      >
        !
      </button>
      {open ? (
        <div style={PANEL_STYLE}>
          <p style={TITLE_STYLE}>error-monitor devtools</p>
          <button
            type="button"
            style={BTN_STYLE}
            onClick={() =>
              setTimeout(() => {
                throw new Error('[error-monitor devtools] runtime 错误');
              }, 0)
            }
          >
            触发 runtime 错误
          </button>
          <button
            type="button"
            style={BTN_STYLE}
            onClick={() => {
              void Promise.reject(new Error('[error-monitor devtools] promise rejection'));
            }}
          >
            触发未捕获 promise
          </button>
          <button
            type="button"
            style={BTN_STYLE}
            onClick={() => {
              const img = document.createElement('img');
              img.src = 'https://example.invalid/not-exist.png';
              img.style.display = 'none';
              document.body.appendChild(img);
            }}
          >
            触发资源加载失败
          </button>
          <button type="button" style={BTN_STYLE} onClick={() => setThrowOnRender(true)}>
            触发 render 错误
          </button>
          <button
            type="button"
            style={BTN_STYLE}
            onClick={() =>
              reportError(new Error('[error-monitor devtools] 手动上报'), {foo: 'bar'})
            }
          >
            手动上报
          </button>
          <button
            type="button"
            style={BTN_STYLE}
            onClick={() => {
              for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                  throw new Error('[error-monitor devtools] 重复错误去重测试');
                }, 0);
              }
            }}
          >
            连续触发同一错误 x5
          </button>
        </div>
      ) : null}
    </>
  );
}
