// src/store/authStore.ts
// Starea globală de autentificare (Zustand)

import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import { AUTH_REDIRECT_URL } from '../lib/authRedirect';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

type AccessBlock = {
  kind: 'ban';
  until?: string | null;
  permanent?: boolean;
};

let profileStatusChannel: any = null;

function isProfileBanned(profile?: Pick<Profile, 'banned_until' | 'ban_permanent'> | null) {
  if (!profile) return false;
  return !!profile.ban_permanent || (!!profile.banned_until && new Date(profile.banned_until).getTime() > Date.now());
}

function getAccessBlockFromProfile(profile: Pick<Profile, 'banned_until' | 'ban_permanent'>): AccessBlock {
  return {
    kind: 'ban',
    until: profile.banned_until ?? null,
    permanent: !!profile.ban_permanent,
  };
}

async function fetchProfileByUserId(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return null;
  return data as Profile;
}

async function syncProfileStatusChannel(userId: string | null, onProfileChange: () => void) {
  if (profileStatusChannel) {
    await supabase.removeChannel(profileStatusChannel);
    profileStatusChannel = null;
  }

  if (!userId) return;

  profileStatusChannel = supabase
    .channel(`profile-access-${userId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () => {
      onProfileChange();
    })
    .subscribe();
}

async function normalizeFunctionInvokeError(error: unknown): Promise<string | null> {
  if (!error) return null;

  const errorWithContext = error as {
    message?: string;
    context?: {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };
  };

  const context = errorWithContext.context;
  if (context?.json) {
    try {
      const payload = await context.json() as { error?: string; message?: string };
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      // Ignore and fall back to other formats.
    }
  }

  if (context?.text) {
    try {
      const text = await context.text();
      if (text.trim()) {
        return text;
      }
    } catch {
      // Ignore and fall back to error.message.
    }
  }

  return errorWithContext.message ?? null;
}

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  accessBlock: AccessBlock | null;
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  confirmSignUp: (email: string, code: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  confirmPasswordReset: (email: string, code: string, password: string) => Promise<{ error: string | null }>;
  updateEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: string | null }>;
  fetchProfile: () => Promise<Profile | null>;
  refreshSessionAccess: (sessionOverride?: Session | null) => Promise<void>;
  clearAccessBlock: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  session: null,
  accessBlock: null,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    set({ isLoading: true });

    try {
      const handleAuthRedirect = async (url: string | null) => {
        if (!url || !url.startsWith(AUTH_REDIRECT_URL)) return;

        const normalizedUrl = url.includes('#') ? `${url.slice(0, url.indexOf('#'))}?${url.slice(url.indexOf('#') + 1)}` : url;
        const parsedUrl = new URL(normalizedUrl);
        const code = parsedUrl.searchParams.get('code');
        const tokenHash = parsedUrl.searchParams.get('token_hash');
        const type = parsedUrl.searchParams.get('type');
        const accessToken = parsedUrl.searchParams.get('access_token');
        const refreshToken = parsedUrl.searchParams.get('refresh_token');

        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
          return;
        }

        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          return;
        }

        if (tokenHash && type) {
          await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as any });
        }
      };

      await handleAuthRedirect(await Linking.getInitialURL());
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user) {
        await get().refreshSessionAccess(session);
      }

      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
          await get().refreshSessionAccess(session);
        } else {
          await syncProfileStatusChannel(null, () => undefined);
          set((state) => ({ user: null, profile: null, session: null, accessBlock: state.accessBlock }));
        }
      });

      Linking.addEventListener('url', ({ url }) => {
        void handleAuthRedirect(url);
      });
    } catch (error) {
      console.error('Failed to initialize auth store:', error);
    } finally {
      set({ isLoading: false, isInitialized: true });
    }
  },

  signIn: async (email, password) => {
    set({ isLoading: true, accessBlock: null });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.session?.user) {
      await get().refreshSessionAccess(data.session);
    }
    set({ isLoading: false });
    return { error: error?.message ?? null };
  },

  signUp: async (email, password, username) => {
    set({ isLoading: true });
    const { error } = await supabase.functions.invoke('request-sign-up', {
      body: { email, password, username },
    });
    const normalizedError = await normalizeFunctionInvokeError(error);
    set({ isLoading: false });
    return { error: normalizedError };
  },

  confirmSignUp: async (email, code) => {
    set({ isLoading: true });
    const { error } = await supabase.functions.invoke('confirm-sign-up', {
      body: { email, code },
    });
    const normalizedError = await normalizeFunctionInvokeError(error);
    set({ isLoading: false });
    return { error: normalizedError };
  },

  resetPassword: async (email) => {
    set({ isLoading: true });
    const { error } = await supabase.functions.invoke('request-password-reset', {
      body: { email },
    });
    const normalizedError = await normalizeFunctionInvokeError(error);
    set({ isLoading: false });
    return { error: normalizedError };
  },

  confirmPasswordReset: async (email, code, password) => {
    set({ isLoading: true });
    const { error } = await supabase.functions.invoke('confirm-password-reset', {
      body: { email, code, password },
    });
    const normalizedError = await normalizeFunctionInvokeError(error);
    set({ isLoading: false });
    return { error: normalizedError };
  },

  updateEmail: async (email) => {
    set({ isLoading: true });
    const { data, error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: AUTH_REDIRECT_URL });
    set({ user: data.user ?? get().user, isLoading: false });
    return { error: error?.message ?? null };
  },

  updatePassword: async (password) => {
    set({ isLoading: true });
    const { data, error } = await supabase.auth.updateUser({ password });
    set({ user: data.user ?? get().user, isLoading: false });
    return { error: error?.message ?? null };
  },

  signOut: async () => {
    await syncProfileStatusChannel(null, () => undefined);
    await supabase.auth.signOut();
    set((state) => ({ user: null, profile: null, session: null, accessBlock: state.accessBlock }));
  },

  fetchProfile: async () => {
    const { user } = get();
    if (!user) return null;

    const profile = await fetchProfileByUserId(user.id);
    if (!profile) return null;

    if (isProfileBanned(profile)) {
      const accessBlock = getAccessBlockFromProfile(profile);
      set({ accessBlock, user: null, profile: null, session: null });
      await syncProfileStatusChannel(null, () => undefined);
      await supabase.auth.signOut();
      return null;
    }

    set({ profile, accessBlock: null });
    return profile;
  },

  refreshSessionAccess: async (sessionOverride) => {
    const activeSession = sessionOverride ?? get().session;
    if (!activeSession?.user) {
      await syncProfileStatusChannel(null, () => undefined);
      set((state) => ({ user: null, profile: null, session: null, accessBlock: state.accessBlock }));
      return;
    }

    const profile = await fetchProfileByUserId(activeSession.user.id);
    if (profile && isProfileBanned(profile)) {
      const accessBlock = getAccessBlockFromProfile(profile);
      set({ accessBlock, user: null, profile: null, session: null });
      await syncProfileStatusChannel(null, () => undefined);
      await supabase.auth.signOut();
      return;
    }

    await syncProfileStatusChannel(activeSession.user.id, () => {
      void get().fetchProfile();
    });

    set({
      user: activeSession.user,
      session: activeSession,
      profile,
      accessBlock: null,
    });
  },

  clearAccessBlock: () => {
    set({ accessBlock: null });
  },

  updateProfile: async (updates) => {
    const { user } = get();
    if (!user) return { error: 'Neautentificat' };

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (!error) {
      set((state) => ({
        profile: state.profile ? { ...state.profile, ...updates } : null,
      }));
    }

    return { error: error?.message ?? null };
  },
}));
