declare module "@tauri-apps/api/dialog" {
  export function open(options: {
    multiple?: boolean;
    filters?: Array<{
      name: string;
      extensions: string[];
    }>;
  }): Promise<string | string[] | null>;
}

declare module "@tauri-apps/api/fs" {
  export function readTextFile(path: string): Promise<string>;
}
