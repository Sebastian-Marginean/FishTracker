import { create } from 'zustand';

interface UnreadState {
  refreshKey: number;
  refreshUnread: () => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  refreshKey: 0,
  refreshUnread: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
}));