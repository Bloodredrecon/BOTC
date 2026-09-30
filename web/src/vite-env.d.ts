/// <reference types="vite/client" />

/** Cache-bust mtime for bg-night.png (legacy). Prefer __TV_BG_PLATES__. */
declare const __TV_BG_MTIME__: string;

/** Scene plates discovered at build/dev start under
 *  public/tv/bg-{night,dawn,day,nomination,gallows,good-win,evil-win}.*; hasLogo from public/tv/plates.json. */
declare const __TV_BG_PLATES__: Record<string, { file: string; mtime: string; hasLogo?: boolean }>;
