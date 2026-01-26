import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;

  setToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        token: null,
        isAuthenticated: false,

        setToken: (token) =>
          set({ token, isAuthenticated: true }, false, 'auth/setToken'),

        logout: () =>
          set({ token: null, isAuthenticated: false }, false, 'auth/logout'),
      }),
      {
        name: 'jarvis-auth',
        partialize: (state) => ({ token: state.token }),
      },
    ),
    { name: 'auth-store' },
  ),
);
