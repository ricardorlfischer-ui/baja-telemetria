/* Biblioteca de sessões: local (IndexedDB) ou servidor da equipe (docs/ARQUITETURA.md 4.4).
 *
 * Modo remoto quando há um endereço de servidor salvo em Preferências, ou quando o app é
 * servido pelo próprio servidor (/api/info responde na mesma origem). Senão, local. */
export * from './types';
export { detectLibrary, type Detected } from './detect';
export { LocalLibrary, gzipText, gunzipToText, hasCompression, newId, guessKind } from './local';
export { RemoteLibrary, ApiError, getToken, setToken, type AuthResult } from './remote';
export { LibraryProvider, useLibrary, type LibraryState } from './context';
