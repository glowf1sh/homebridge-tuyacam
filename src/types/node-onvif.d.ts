declare module 'node-onvif' {
  export function startProbe(): Promise<void>;
  export function stopProbe(): void;
  export function onDiscover(callback: (device: any) => void): void;
}