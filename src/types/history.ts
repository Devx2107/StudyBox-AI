export type HistorySource = 'chat' | 'vision' | 'voice' | 'quiz';

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
