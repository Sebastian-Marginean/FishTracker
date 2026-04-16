// src/store/authStore.ts
// Starea globală de autentificare (Zustand)

import { create } from 'zustand';
import type { User, Session } from '@supabase/supabase-js';
import { Linking } from 'react-native';
import { AUTH_REDIRECT_URL } from '../lib/authRedirect';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

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
  isLoading: boolean;
  isInitialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  confirmPasswordReset: (email: string, code: string, password: string) => Promise<{ error: string | null }>;
  updateEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: string | null }>;
  fetchProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  session: null,
  isLoading: false,
  isInitialized: false,

  initialize: async () => {
    set({ isLoading: true });

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
      set({ user: session.user, session });
      await get().fetchProfile();
    }

    // Ascultă schimbările de auth în timp real
    supabase.auth.onAuthStateChange(async (_event, session) => {
      set({ user: session?.user ?? null, session });
      if (session?.user) {
        await get().fetchProfile();
      } else {
        set({ profile: null });
      }
    });

    Linking.addEventListener('url', ({ url }) => {
      void handleAuthRedirect(url);
    });

    set({ isLoading: false, isInitialized: true });
  },

  signIn: async (email, password) => {
    set({ isLoading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ isLoading: false });
    return { error: error?.message ?? null };
  },

  signUp: async (email, password, username) => {
    set({ isLoading: true });

    // Verifică dacă username-ul e disponibil
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .single();

    if (existing) {
      set({ isLoading: false });
      return { error: 'Username-ul este deja folosit' };
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, full_name: username },
        emailRedirectTo: AUTH_REDIRECT_URL,
      },
    });

    set({ isLoading: false });
    return { error: error?.message ?? null };
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
    await supabase.auth.signOut();
    set({ user: null, profile: null, session: null });
  },

  fetchProfile: async () => {
    const { user } = get();
    if (!user) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!error && data) {
      set({ profile: data as Profile });
    }
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
