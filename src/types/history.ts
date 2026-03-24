export type HistorySource = 'chat' | 'tools' | 'vision' | 'voice';

export interface HistoryEntry {
  id: string;
  source: HistorySource;
  prompt: string;
  response: string;
  createdAt: string;
}

export interface HistoryReporter {
  onHistoryEntry?: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => void;
}
