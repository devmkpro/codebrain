export interface WorkspaceConfig {
  favoritePane?: FavoritePane;
  [key: string]: unknown;
}

export interface FavoritePane {
  providerId?: string;
  model?: string;
  agent?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  extension?: string;
}
