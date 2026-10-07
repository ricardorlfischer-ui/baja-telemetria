/* Biblioteca de sessões: local (IndexedDB) ou servidor da equipe (docs/ARQUITETURA.md 4.4).
 *
 * Modo remoto quando há um endereço de servidor salvo em Preferências, ou quando o app é
 * servido pelo próprio servidor (/api/info responde na mesma origem). Senão, local. */
export * from './types';
export { detectLibrary, type Detected } from './detect';
export { LocalLibrary, LocalDuplicateError, LocalNotFoundError, gzipText, gunzipToText, hasCompression, newId, guessKind, sha256Hex } from './local';
export { RemoteLibrary, ApiError, PC_OFFLINE_MSG, getToken, setToken, type AuthResult, type UploadProgress } from './remote';
export { LibraryProvider, useLibrary, type LibraryState } from './context';
export {
  LocalQuotaError, QUOTA_MESSAGE, ensurePersisted, fmtBytes, isQuotaError, requestPersist, storageErrorMessage, storageStatus,
  type StorageStatus,
} from './storage';
export { fmtSessionDate, fmtDateTime, sessionDateText } from './format';
