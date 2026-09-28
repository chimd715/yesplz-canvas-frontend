import { createContext, useContext } from 'react';
import type { VersionHistoryState } from './index';

const VersionHistoryContext = createContext<VersionHistoryState | null>(null);
export const VersionHistoryProvider = VersionHistoryContext.Provider;
export const useVersionHistory = (): VersionHistoryState | null => useContext(VersionHistoryContext);
