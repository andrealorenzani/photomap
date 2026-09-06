import { create } from 'zustand';
import * as adminApi from './../lib/api/adminApi';
import { resetCsrfTokenCache } from '../lib/api/http';

export type AdminAuthStatus = 'idle' | 'checking' | 'authenticated' | 'anonymous';

/**
 * A fully separate Zustand store from `photoStore`/`authStore` — the admin console is a
 * self-contained page/component tree (like `SharePage`) that must never touch guest-mode or
 * main-app photo-viewing state.
 */
interface AdminState {
  status: AdminAuthStatus;
  username: string | null;
  error: string | null;

  restoreSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  status: 'idle',
  username: null,
  error: null,

  restoreSession: async () => {
    set({ status: 'checking' });
    try {
      const identity = await adminApi.adminMe();
      if (identity) {
        set({ status: 'authenticated', username: identity.username, error: null });
      } else {
        set({ status: 'anonymous', username: null });
      }
    } catch {
      set({ status: 'anonymous', username: null });
    }
  },

  login: async (username, password) => {
    set({ error: null });
    try {
      const identity = await adminApi.adminLogin(username, password);
      set({ status: 'authenticated', username: identity.username, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed.' });
      throw err;
    }
  },

  logout: async () => {
    try {
      await adminApi.adminLogout();
    } finally {
      // The admin session is entirely separate from the regular user session, but they share
      // the same browser-tab CSRF token cache in http.ts — reset it exactly as the regular
      // logout flow does, so any next admin (or regular) login fetches a fresh token rather
      // than reusing one tied to the now-destroyed session.
      resetCsrfTokenCache();
      set({ status: 'anonymous', username: null, error: null });
    }
  },

  clearError: () => set({ error: null }),
}));
