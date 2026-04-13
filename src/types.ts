export interface RuntimeEntry {
  sourcePath: string;
  enabled: boolean;
  runtimePath?: string;
  loadedAt?: string;
}

export interface Manifest {
  version: 1;
  entries: RuntimeEntry[];
}
