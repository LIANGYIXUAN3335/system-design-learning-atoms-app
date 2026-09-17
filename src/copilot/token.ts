import { Platform } from 'react-native';

/**
 * The Copilot key is deliberately separate from sync. It is never injected into
 * a public web bundle: the learner enters it on first use and the browser keeps
 * it locally for later reviews.
 */
const TOKEN_KEY = 'atoms.copilot.token';

function browser(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function peekCopilotToken(): string | null {
  return browser() ? window.localStorage.getItem(TOKEN_KEY)?.trim() || null : null;
}

export function ensureCopilotToken(): string | null {
  const stored = peekCopilotToken();
  if (stored) return stored;
  if (!browser()) return null;
  const entered = window.prompt('请输入 Atom Copilot access key');
  const token = entered?.trim() || null;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export function clearCopilotToken(): void {
  if (browser()) window.localStorage.removeItem(TOKEN_KEY);
}

export function copilotKeyCanBeEntered(): boolean {
  return browser();
}
