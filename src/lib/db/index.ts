export { getDB, resetDBConnectionForTests, DB_NAME, DB_VERSION } from './schema';
export type { PhotoBlobs, FolderRecord, PhotomapDBSchema } from './schema';
export {
  IndexedDbPhotoRepository,
  StorageQuotaExceededError,
  photoRepository,
  getActiveRepository,
  setActiveRepository,
} from './photoRepository';
export type { PhotoRepository } from './photoRepository';
export { ApiPhotoRepository, apiPhotoId, backendIdFromApiPhotoId } from './apiPhotoRepository';
