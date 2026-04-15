export type OpenTab = {
  id: number;
  url?: string;
  title?: string;
  windowId: number;
  active: boolean;
  isTabOut: boolean;
};

export type SavedTab = {
  id: string;
  url: string;
  title: string;
  savedAt: string;
  completed: boolean;
  dismissed: boolean;
  completedAt?: string;
};

export type DomainGroup = {
  domain: string;
  label?: string;
  tabs: OpenTab[];
};
