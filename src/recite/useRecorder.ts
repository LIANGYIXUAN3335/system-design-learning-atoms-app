import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 录音器 · web 实现（MediaRecorder）。
 *
 * 基文件保持 web-safe（MermaidView 的分身惯例）：有些 Expo web 配置解析不到 .web.ts，
 * 基文件必须自己就能在浏览器里跑。原生走 useRecorder.native.ts（expo-audio）。
 *
 * **mime 三选一**（原样抄 jobscan static/recite.js 的注释和顺序）：Safari 只给 audio/mp4，
 * Chrome 给 audio/webm，写死任何一个就等于在另一个浏览器上一按录音就抛。
 * 127.0.0.1 和 https 都是 secure context，getUserMedia 可用。
 */

export type RecorderState = 'idle' | 'recording' | 'stopped';

export interface RecordingResult {
  /** web：录下来的 Blob */
  blob: Blob | null;
  /** 原生：录音文件 URI */
  uri: string | null;
  mimeType: string;
  durationSec: number;
  /** 立刻回听用的地址（web 是 objectURL，原生就是 uri） */
  playbackUrl: string | null;
}

export interface Recorder {
  state: RecorderState;
  elapsedSec: number;
  /** 拿不到麦克风之类的人话错误 */
  error: string | null;
  /** 正在等浏览器/系统的麦克风授权弹窗 —— 这段时间按钮必须显式说自己在等 */
  requesting: boolean;
  supported: boolean;
  start(): Promise<void>;
  stop(): Promise<RecordingResult | null>;
}

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of MIMES) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return ''; // 让浏览器自己挑
}

export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSec, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const urlRef = useRef<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(
    () => () => {
      clearTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError('这个浏览器不支持录音（需要 MediaRecorder + 麦克风权限）。');
      return;
    }
    let stream: MediaStream;
    // 授权弹窗弹出来到她点「允许」之间，这个 await 会挂很久。不显式标出来，
    // 按钮就一直是「● 录音」，看起来像点了没反应。
    setRequesting(true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof Error ? e.name : String(e);
      setError(`拿不到麦克风：${name} —— 在地址栏左边的图标里允许麦克风，然后刷新。`);
      return;
    } finally {
      setRequesting(false);
    }
    const m = pickMime();
    let rec: MediaRecorder;
    try {
      rec = m ? new MediaRecorder(stream, { mimeType: m }) : new MediaRecorder(stream);
    } catch {
      rec = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunksRef.current.push(e.data);
    };
    recRef.current = rec;
    streamRef.current = stream;
    rec.start();
    startedAt.current = Date.now();
    setElapsed(0);
    setState('recording');
    clearTimer();
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200);
  }, [supported]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const rec = recRef.current;
    if (!rec || rec.state !== 'recording') return null;
    const durationSec = (Date.now() - startedAt.current) / 1000;
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.stop();
    });
    clearTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(blob);
    setElapsed(durationSec);
    setState('stopped');
    return {
      blob,
      uri: null,
      mimeType: blob.type || 'audio/webm',
      durationSec,
      playbackUrl: urlRef.current,
    };
  }, []);

  return { state, elapsedSec, error, requesting, supported, start, stop };
}
