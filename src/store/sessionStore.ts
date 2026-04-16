// src/store/sessionStore.ts
// Starea globală a partidei active + sincronizare offline

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import {
  saveActiveSession,
  loadActiveSession,
  clearActiveSession,
  saveRodCastTime,
  loadRodCastTime,
  clearRodCastTime,
  addPendingCatch,
  loadPendingCatches,
  removePendingCatch,
  removePendingCatchesForRod,
  type PendingCatch,
} from '../lib/storage';
import type { LocalSessionState, LocalRodState, RodNumber, WeatherSnapshot } from '../types';

const ALL_ROD_NUMBERS: RodNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const buildRodState = (rodNumber: RodNumber): LocalRodState => ({
  rodNumber,
  baitName: '',
  hookSetup: '',
  castCount: 0,
  lastCastTimestamp: null,
  catchCount: 0,
  rodId: null,
});

const DEFAULT_RODS = (count = 1): LocalRodState[] =>
  ALL_ROD_NUMBERS.slice(0, Math.max(1, Math.min(10, count))).map((n) => buildRodState(n));

interface SessionStoreState {
  activeSession: LocalSessionState | null;
  isLoading: boolean;

  // Inițializare din stocare locală
  loadFromStorage: () => Promise<void>;

  // Pornire / oprire partidă
  startSession: (locationId: string | null, locationName: string, weather?: WeatherSnapshot) => Promise<void>;
  endSession: () => Promise<void>;
  updateSessionLocation: (locationId: string | null, locationName: string) => Promise<void>;

  // Lansete
  addRod: () => number | null;
  removeRod: (rodNumber: number) => Promise<boolean>;
  castRod: (rodNumber: number) => void;
  updateRod: (rodNumber: number, updates: Partial<LocalRodState>) => void;
  saveRodSetup: (rodNumber: number, updates: Partial<LocalRodState>, userId?: string) => Promise<void>;
  resetRodTimer: (rodNumber: number) => void;

  // Capturi
  addCatch: (rodNumber: number, catchData: Omit<PendingCatch, 'tempId' | 'sessionId' | 'rodNumber' | 'caughtAt'>) => Promise<void>;

  // Sincronizare cu Supabase
  syncToSupabase: (userId: string) => Promise<void>;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  activeSession: null,
  isLoading: false,

  loadFromStorage: async () => {
    const saved = await loadActiveSession();
    if (saved?.isActive) {
      // Restaurăm timestamp-urile din MMKV pentru fiecare lansetă
      const restoredRods = await Promise.all(saved.rods.map(async (rod) => ({
        ...rod,
        lastCastTimestamp: await loadRodCastTime(rod.rodNumber),
      })));
      set({ activeSession: { ...saved, rods: restoredRods } });
    }
  },

  startSession: async (locationId, locationName, weather) => {
    set({ isLoading: true });
    const newSession: LocalSessionState = {
      sessionId: null,
      locationId,
      locationName,
      startedAt: Date.now(),
      isActive: true,
      rods: DEFAULT_RODS(),
      isSynced: false,
    };

    set({ activeSession: newSession, isLoading: false });
    void saveActiveSession(newSession);
  },

  endSession: async () => {
    const { activeSession } = get();
    if (!activeSession) return;

    const ended = { ...activeSession, isActive: false };
    await clearActiveSession();
    set({ activeSession: null });

    // Dacă are sessionId real, marchează ca terminată în DB
    if (ended.sessionId) {
      await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), is_active: false })
        .eq('id', ended.sessionId);
    }
  },

  updateSessionLocation: async (locationId, locationName) => {
    const { activeSession } = get();
    if (!activeSession) return;

    const updatedSession = {
      ...activeSession,
      locationId,
      locationName,
      isSynced: false,
    };

    set({ activeSession: updatedSession });
    void saveActiveSession(updatedSession);

    if (updatedSession.sessionId) {
      await supabase
        .from('sessions')
        .update({ location_id: locationId })
        .eq('id', updatedSession.sessionId);

      set((state) => {
        if (!state.activeSession) return state;
        const synced = { ...state.activeSession, isSynced: true };
        void saveActiveSession(synced);
        return { activeSession: synced };
      });
    }
  },

  addRod: () => {
    const { activeSession } = get();
    if (!activeSession) return null;

    const nextRodNumber = ALL_ROD_NUMBERS.find((rodNumber) =>
      !activeSession.rods.some((rod) => rod.rodNumber === rodNumber)
    );

    if (!nextRodNumber) return null;

    const updatedSession = {
      ...activeSession,
      rods: [...activeSession.rods, buildRodState(nextRodNumber)],
      isSynced: false,
    };

    set({ activeSession: updatedSession });
    void saveActiveSession(updatedSession);
    return nextRodNumber;
  },

  removeRod: async (rodNumber) => {
    const { activeSession } = get();
    if (!activeSession || activeSession.rods.length <= 1) return false;

    const rodToRemove = activeSession.rods.find((rod) => rod.rodNumber === rodNumber);
    if (!rodToRemove) return false;

    const updatedSession = {
      ...activeSession,
      rods: activeSession.rods.filter((rod) => rod.rodNumber !== rodNumber),
      isSynced: false,
    };

    set({ activeSession: updatedSession });
    await clearRodCastTime(rodNumber);
    await removePendingCatchesForRod(activeSession.sessionId, rodNumber);
    void saveActiveSession(updatedSession);

    if (rodToRemove.rodId) {
      const { error } = await supabase
        .from('rods')
        .delete()
        .eq('id', rodToRemove.rodId);

      if (error) {
        set({ activeSession });
        void saveActiveSession(activeSession);
        return false;
      }
    }

    return true;
  },

  castRod: (rodNumber) => {
    const now = Date.now();
    void saveRodCastTime(rodNumber, now);

    set((state) => {
      if (!state.activeSession) return state;
      const rods = state.activeSession.rods.map((r) =>
        r.rodNumber === rodNumber
          ? { ...r, castCount: r.castCount + 1, lastCastTimestamp: now }
          : r
      );
      const updated = { ...state.activeSession, rods, isSynced: false };
      void saveActiveSession(updated);
      return { activeSession: updated };
    });
  },

  resetRodTimer: (rodNumber) => {
    const now = Date.now();
    void saveRodCastTime(rodNumber, now);

    set((state) => {
      if (!state.activeSession) return state;
      const rods = state.activeSession.rods.map((r) =>
        r.rodNumber === rodNumber ? { ...r, lastCastTimestamp: now } : r
      );
      const updated = { ...state.activeSession, rods, isSynced: false };
      void saveActiveSession(updated);
      return { activeSession: updated };
    });
  },

  updateRod: (rodNumber, updates) => {
    set((state) => {
      if (!state.activeSession) return state;
      const rods = state.activeSession.rods.map((r) =>
        r.rodNumber === rodNumber ? { ...r, ...updates } : r
      );
      const updated = { ...state.activeSession, rods, isSynced: false };
      void saveActiveSession(updated);
      return { activeSession: updated };
    });
  },

  saveRodSetup: async (rodNumber, updates, userId) => {
    const previousRod = get().activeSession?.rods.find((rod) => rod.rodNumber === rodNumber);
    if (!previousRod) return;

    const nextBait = updates.baitName ?? previousRod.baitName;
    const nextHook = updates.hookSetup ?? previousRod.hookSetup;
    const baitChanged = nextBait !== previousRod.baitName;
    const hookChanged = nextHook !== previousRod.hookSetup;

    get().updateRod(rodNumber, updates);

    if ((!baitChanged && !hookChanged) || !userId) {
      return;
    }

    await get().syncToSupabase(userId);

    const syncedSession = get().activeSession;
    const syncedRod = syncedSession?.rods.find((rod) => rod.rodNumber === rodNumber);
    if (!syncedSession?.sessionId || !syncedRod) {
      return;
    }

    const { error } = await supabase.from('rod_setup_history').insert({
      session_id: syncedSession.sessionId,
      rod_id: syncedRod.rodId ?? null,
      user_id: userId,
      rod_number: rodNumber,
      bait_name: syncedRod.baitName.trim() || null,
      hook_setup: syncedRod.hookSetup.trim() || null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.warn('Log istoric nada/montura esuat:', error.message);
    }
  },

  addCatch: async (rodNumber, catchData) => {
    const { activeSession } = get();
    const tempId = `temp_${Date.now()}_${rodNumber}`;

    const pending: PendingCatch = {
      tempId,
      sessionId: activeSession?.sessionId ?? null,
      rodNumber,
      caughtAt: Date.now(),
      ...catchData,
    };

    await addPendingCatch(pending);

    // Actualizează contorul local imediat
    set((state) => {
      if (!state.activeSession) return state;
      const rods = state.activeSession.rods.map((r) =>
        r.rodNumber === rodNumber ? { ...r, catchCount: r.catchCount + 1 } : r
      );
      const updated = { ...state.activeSession, rods, isSynced: false };
      void saveActiveSession(updated);
      return { activeSession: updated };
    });
  },

  syncToSupabase: async (userId: string) => {
    let activeSession = get().activeSession;
    if (!activeSession) return;

    set({ isLoading: true });

    try {
      // 1. Creează sesiunea în DB dacă nu există
      let sessionId = activeSession.sessionId;
      if (!sessionId) {
        const { data, error } = await supabase
          .from('sessions')
          .insert({
            user_id: userId,
            location_id: activeSession.locationId,
            started_at: new Date(activeSession.startedAt).toISOString(),
            is_active: true,
          })
          .select('id')
          .single();

        if (error) throw error;
        sessionId = data.id;

        set((state) => {
          if (!state.activeSession) return state;
          const updated = { ...state.activeSession, sessionId, isSynced: true };
          void saveActiveSession(updated);
          return { activeSession: updated };
        });

        activeSession = get().activeSession;
        if (!activeSession) return;
      }

      // 2. Upsert lansete
      const rodIdMap: Record<number, string | null> = {};
      for (const rod of activeSession.rods) {
        try {
          const { data: rodData, error: rodError } = await supabase
            .from('rods')
            .upsert({
              id: rod.rodId ?? undefined,
              session_id: sessionId,
              rod_number: rod.rodNumber,
              bait_custom: rod.baitName,
              hook_setup: rod.hookSetup,
              cast_count: rod.castCount,
              catch_count: rod.catchCount,
              last_cast_at: rod.lastCastTimestamp
                ? new Date(rod.lastCastTimestamp).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'session_id,rod_number' })
            .select('id')
            .single();

          if (rodError) {
            console.warn(`Sync lansetă ${rod.rodNumber} eșuat:`, rodError.message);
          }

          rodIdMap[rod.rodNumber] = rodData?.id ?? rod.rodId ?? null;

          if (rodData && !rod.rodId) {
            get().updateRod(rod.rodNumber, { rodId: rodData.id });
          }
        } catch (rodError) {
          rodIdMap[rod.rodNumber] = rod.rodId ?? null;
          console.warn(`Sync lansetă ${rod.rodNumber} a aruncat excepție:`, rodError);
        }
      }

      // 3. Sincronizează capturile locale pentru sesiunea curentă
      const pendingCatches = await loadPendingCatches();
      const catchesForSession = pendingCatches.filter((item) =>
        item.sessionId === sessionId || item.sessionId === activeSession.sessionId || item.sessionId === null
      );

      for (const pendingCatch of catchesForSession) {
        const { error } = await supabase
          .from('catches')
          .insert({
            session_id: sessionId,
            rod_id: rodIdMap[pendingCatch.rodNumber] ?? null,
            user_id: userId,
            location_id: get().activeSession?.locationId ?? activeSession.locationId,
            group_id: pendingCatch.groupId ?? null,
            fish_species: pendingCatch.fishSpecies ?? null,
            weight_kg: pendingCatch.weightKg ?? null,
            caught_at: new Date(pendingCatch.caughtAt).toISOString(),
            notes: pendingCatch.notes ?? null,
          });

        if (!error) {
          await removePendingCatch(pendingCatch.tempId);
        } else {
          console.warn('Sync captură eșuat:', error.message);
        }
      }

      set((state) => {
        if (!state.activeSession) return state;
        const updated = { ...state.activeSession, isSynced: true };
        void saveActiveSession(updated);
        return { activeSession: updated };
      });
    } catch (err) {
      console.warn('Sync eșuat, date salvate local:', err);
    } finally {
      set({ isLoading: false });
    }
  },
}));
