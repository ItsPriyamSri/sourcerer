/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Optional: point the build at a hosted brain (Render) instead of localhost. */
  readonly VITE_BRAIN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
