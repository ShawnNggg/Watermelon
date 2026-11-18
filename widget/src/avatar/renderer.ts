import type { Intent } from './types';

export interface AvatarRenderer {
  apply(intent: Intent): void;
  setLook(x: number, y: number): void;   // 0..100 each
  setDrag(on: boolean): void;
  tap(): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

/** Try the primary renderer; on any failure (missing .riv, wasm error) use the fallback. */
export async function createRenderer(
  primary: () => Promise<AvatarRenderer>,
  fallback: () => AvatarRenderer,
  onFallback?: (err: unknown) => void,
): Promise<AvatarRenderer> {
  try {
    return await primary();
  } catch (err) {
    onFallback?.(err);
    return fallback();
  }
}
