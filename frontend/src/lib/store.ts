import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  is_verified: boolean;
  created_at: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;
  login: (user: User, token: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      _hasHydrated: false,
      login: (user, token, refreshToken) =>
        set({ user, token, refreshToken, isAuthenticated: true }),
      setUser: (user) => set({ user }),
      logout: () =>
        set({ user: null, token: null, refreshToken: null, isAuthenticated: false }),
      setHasHydrated: (state) => set({ _hasHydrated: state }),
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

// ── Dashboard Analysis Persistence ────────────────────────────
// Survives page navigation, clears on browser close (sessionStorage)

/* eslint-disable @typescript-eslint/no-explicit-any */
interface DashboardState {
  selectedDataset: string;
  analysisResult: any | null;
  sessionId: string | null;
  messages: any[];
  dataProfile: any | null;
  suggestedQuestions: string[];
  setSelectedDataset: (id: string) => void;
  setAnalysisResult: (result: any | null) => void;
  setSessionId: (id: string | null) => void;
  setMessages: (msgs: any[]) => void;
  setDataProfile: (profile: any | null) => void;
  setSuggestedQuestions: (q: string[]) => void;
  clearDashboard: () => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      selectedDataset: "",
      analysisResult: null,
      sessionId: null,
      messages: [],
      dataProfile: null,
      suggestedQuestions: [],
      setSelectedDataset: (id) => set({ selectedDataset: id }),
      setAnalysisResult: (result) => set({ analysisResult: result }),
      setSessionId: (id) => set({ sessionId: id }),
      setMessages: (msgs) => set({ messages: msgs }),
      setDataProfile: (profile) => set({ dataProfile: profile }),
      setSuggestedQuestions: (q) => set({ suggestedQuestions: q }),
      clearDashboard: () => set({
        selectedDataset: "",
        analysisResult: null,
        sessionId: null,
        messages: [],
        dataProfile: null,
        suggestedQuestions: [],
      }),
    }),
    {
      name: "dashboard-analysis",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
