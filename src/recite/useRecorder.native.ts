import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import type { Recorder, RecorderState, RecordingResult } from './useRecorder';

export type { Recorder, RecorderState, RecordingResult } from './useRecorder';

/**
 * 录音器 · iOS/Android 实现（expo-audio SDK 57）。
 *
 * HIGH_QUALITY 预设出的是 .m4a（Android 同样是 m4a），所以上传的 content-type 写 audio/m4a，
 * 服务端按它决定扩展名。`setAudioModeAsync({allowsRecording, playsInSilentMode})` 必须在
 * record() 之前 —— 否则 iOS 上静音键按下时录完回听是没有声音的，会被误当成「录空了」。
 */
export function useRecorder(): Recorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSec, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const startedAt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  const start = useCallback(async () => {
    setError(null);
    // iOS 第一次会弹系统授权框，这个 await 挂多久取决于她什么时候点。
    setRequesting(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('没拿到麦克风权限 —— 去系统设置里给 Atoms 开麦克风，再回来。');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`录音起不来：${msg}`);
      return;
    } finally {
      setRequesting(false);
    }
    startedAt.current = Date.now();
    setElapsed(0);
    setState('recording');
    clearTimer();
    timerRef.current = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 200);
  }, [recorder]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    if (state !== 'recording') return null;
    const durationSec = (Date.now() - startedAt.current) / 1000;
    clearTimer();
    try {
      await recorder.stop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`停止录音时出错：${msg}`);
    }
    // 停了之后再放开录音会话，不然播放会走听筒而不是扬声器。
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri ?? null;
    setElapsed(durationSec);
    setState('stopped');
    if (!uri) {
      setError('录音结束了但拿不到文件路径 —— 再录一遍试试。');
      return null;
    }
    return { blob: null, uri, mimeType: 'audio/m4a', durationSec, playbackUrl: uri };
  }, [recorder, state]);

  return { state, elapsedSec, error, requesting, supported: true, start, stop };
}
