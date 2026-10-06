/// <reference types="vite/client" />

/* Variáveis de build (Vite). VITE_API_URL: servidor da equipe padrão (pages.yml passa a
 * variável API_URL do repositório); vazio = biblioteca local ou servidor na mesma origem. */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
