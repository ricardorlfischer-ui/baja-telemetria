/// <reference types="vite/client" />

/* Variáveis de build (Vite). VITE_API_URL: servidor da equipe padrão (pages.yml passa a
 * variável API_URL do repositório); vazio = biblioteca local ou servidor na mesma origem.
 * VITE_STATIC: '1' = hospedagem estática (GitHub Pages): não procura /api na mesma origem.
 * VITE_BASE: caminho de publicação (ex.: /baja-telemetria/). */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_BASE?: string;
  readonly VITE_STATIC?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
