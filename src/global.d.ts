export {};

declare global {
  interface Window {
    sinavProgramiRobotu?: {
      platform?: string;
      electronVersion?: string;
      storage?: {
        readSync: () => unknown;
        writeSync: (payload: unknown) => { ok?: boolean; error?: string } | unknown;
      };
    };
  }
}
