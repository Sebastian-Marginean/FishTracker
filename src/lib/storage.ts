// src/lib/storage.ts
// Stocare locală offline cu MMKV
// Cronometrele lansetelor supraviețuiesc kill-ului aplicației!

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocalSessionState, LocalRodState } from '../types';



const KEYS = {
  ACTIVE_SESSION: 'active_session',
  PENDING_CATCHES: 'pending_catches',
  UPDATE_NOTICE_PREFIX: 'update_notice_seen_',
};

// ─── Session activă ───────────────────────────────────────────


export const saveActiveSession = async (session: LocalSessionState): Promise<void> => {
  await AsyncStorage.setItem(KEYS.ACTIVE_SESSION, JSON.stringify(session));
};

export const loadActiveSession = async (): Promise<LocalSessionState | null> => {
  const raw = await AsyncStorage.getItem(KEYS.ACTIVE_SESSION);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalSessionState;
  } catch {
    return null;
  }
};

export const clearActiveSession = async (): Promise<void> => {
  await AsyncStorage.removeItem(KEYS.ACTIVE_SESSION);
};

// ─── Cronometre lansete ───────────────────────────────────────
// Salvăm timestamp-ul de start, nu intervalul
// Astfel la redeschidere calculăm: Date.now() - startTimestamp


export const saveRodCastTime = async (rodNumber: number, timestamp: number): Promise<void> => {
  await AsyncStorage.setItem(`rod_cast_${rodNumber}`, timestamp.toString());
};

export const loadRodCastTime = async (rodNumber: number): Promise<number | null> => {
  const val = await AsyncStorage.getItem(`rod_cast_${rodNumber}`);
  return val ? Number(val) : null;
};

export const clearRodCastTime = async (rodNumber: number): Promise<void> => {
  await AsyncStorage.removeItem(`rod_cast_${rodNumber}`);
};

// Calculează secundele scurse de la ultima aruncare
export const getElapsedSeconds = async (rodNumber: number): Promise<number> => {
  const startTs = await loadRodCastTime(rodNumber);
  if (!startTs) return 0;
  return Math.floor((Date.now() - startTs) / 1000);
};

// ─── Capturi offline (nesinc-ate) ─────────────────────────────

export interface PendingCatch {
  tempId: string;
  sessionId: string | null;
  rodNumber: number;
  groupId?: string | null;
  fishSpecies?: string;
  weightKg?: number;
  photoUri?: string;
  caughtAt: number;
  notes?: string;
}

export const addPendingCatch = async (catchData: PendingCatch): Promise<void> => {
  const existing = await loadPendingCatches();
  existing.push(catchData);
  await AsyncStorage.setItem(KEYS.PENDING_CATCHES, JSON.stringify(existing));
};

export const loadPendingCatches = async (): Promise<PendingCatch[]> => {
  const raw = await AsyncStorage.getItem(KEYS.PENDING_CATCHES);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingCatch[];
  } catch {
    return [];
  }
};

export const removePendingCatch = async (tempId: string): Promise<void> => {
  const existing = await loadPendingCatches();
  const filtered = existing.filter((c) => c.tempId !== tempId);
  await AsyncStorage.setItem(KEYS.PENDING_CATCHES, JSON.stringify(filtered));
};

export const removePendingCatchesForRod = async (sessionId: string | null, rodNumber: number): Promise<void> => {
  const existing = await loadPendingCatches();
  const filtered = existing.filter((catchItem) => !(catchItem.sessionId === sessionId && catchItem.rodNumber === rodNumber));
  await AsyncStorage.setItem(KEYS.PENDING_CATCHES, JSON.stringify(filtered));
};

export const clearPendingCatches = async (): Promise<void> => {
  await AsyncStorage.removeItem(KEYS.PENDING_CATCHES);
};

export const hasSeenNotice = async (noticeId: string): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(`${KEYS.UPDATE_NOTICE_PREFIX}${noticeId}`);
  return raw === '1';
};

export const markNoticeSeen = async (noticeId: string): Promise<void> => {
  await AsyncStorage.setItem(`${KEYS.UPDATE_NOTICE_PREFIX}${noticeId}`, '1');
};

export const hasSeenUpdateNotice = async (version: string): Promise<boolean> => {
  return hasSeenNotice(version);
};

export const markUpdateNoticeSeen = async (version: string): Promise<void> => {
  await markNoticeSeen(version);
};
