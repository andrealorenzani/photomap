import { create } from 'zustand';
import * as authApi from '../lib/api/authApi';
import { deleteAccount as deleteAccountApi } from '../lib/api/accountApi';
import { resetCsrfTokenCache } from '../lib/api/http';
import {
  ApiPhotoRepository,
  IndexedDbPhotoRepository,
  setActiveRepository,
} from '../lib/db';
import { usePhotoStore } from './photoStore';

export type AuthStatus = 'idle' | 'checking' | 'authenticated' | 'guest';

interface AuthState {
  status: AuthStatus;
  user: { email: string } | null;
  error: string | null;

  restoreSession: () => Promise<void>;
  register: (email: string, password: string, honeypot: string, formRenderedAt: number) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

async function enterAccountMode(): Promise<void> {
  setActiveRepository(new ApiPhotoRepository());
  await usePhotoStore.getState().hydrateFromDB();
  usePhotoStore.getState().setSearchFilters({});
}

async function enterGuestMode(): Promise<void> {
  setActiveRepository(new IndexedDbPhotoRepository());
  resetCsrfTokenCache();
  await usePhotoStore.getState().hydrateFromDB();
  usePhotoStore.getState().setSearchFilters({});
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  error: null,

  restoreSession: async () => {
    set({ status: 'checking' });
    try {
      const user = await authApi.me();
      if (user) {
        await enterAccountMode();
        set({ status: 'authenticated', user: { email: user.email }, error: null });
      } else {
        // Still hydrates from IndexedDB (the default active repository already is
        // IndexedDbPhotoRepository, so this is a no-op repository swap) — a page load with no
        // live session must behave exactly like Phase 1's guest mode always did.
        await enterGuestMode();
        set({ status: 'guest', user: null });
      }
    } catch {
      // Network/server error resolving session state: fall back to guest mode rather than
      // leaving the app stuck in "checking" forever.
      await enterGuestMode();
      set({ status: 'guest', user: null });
    }
  },

  register: async (email, password, honeypot, formRenderedAt) => {
    set({ error: null });
    try {
      await authApi.register(email, password, honeypot, formRenderedAt);
      await authApi.login(email, password);
      await enterAccountMode();
      set({ status: 'authenticated', user: { email }, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Registration failed.' });
      throw err;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const user = await authApi.login(email, password);
      await enterAccountMode();
      set({ status: 'authenticated', user: { email: user.email }, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Login failed.' });
      throw err;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      await enterGuestMode();
      set({ status: 'guest', user: null, error: null });
    }
  },

  deleteAccount: async () => {
    await deleteAccountApi();
    await enterGuestMode();
    set({ status: 'guest', user: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
