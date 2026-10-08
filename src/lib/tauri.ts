import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createGoogle, AuthRequiredError } from './google';
import type { Snapshot } from './types';

async function getToken(force = false): Promise<string> {
  try {
    return await invoke<string>('get_access_token', { force });
  } catch (e) {
    if (e === 'auth_required') throw new AuthRequiredError();
    throw new Error(String(e));
  }
}

export const google = createGoogle(tauriFetch, getToken);

export const signIn = () => invoke<void>('sign_in');

export async function loadCache(): Promise<Snapshot | null> {
  const raw = await invoke<string | null>('read_cache');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null; // corrupt cache: start fresh
  }
}

export const saveCache = (s: Snapshot) => invoke<void>('write_cache', { json: JSON.stringify(s) });

export const toggleMode = () => invoke<string>('toggle_mode');
export const getMode = () => invoke<string>('get_mode');
export const hideWindow = () => invoke<void>('hide_window');

export const onVisibility = (cb: (visible: boolean) => void) => listen<boolean>('visibility', (e) => cb(e.payload));
export const onMode = (cb: (mode: string) => void) => listen<string>('mode', (e) => cb(e.payload));

export { openUrl };
