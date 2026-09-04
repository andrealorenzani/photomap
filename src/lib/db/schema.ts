import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PhotoRecord } from '../../types';

export const DB_NAME = 'photomap-guest';
export const DB_VERSION = 1;

export interface PhotoBlobs {
  id: string;
  thumbnail?: Blob;
  preview?: Blob;
}

export interface FolderRecord {
  id: string;
  name: string;
  lastOpened: number;
}

export interface PhotomapDBSchema extends DBSchema {
  photoMeta: {
    key: string;
    value: PhotoRecord;
  };
  photoBlobs: {
    key: string;
    value: PhotoBlobs;
  };
  folders: {
    key: string;
    value: FolderRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<PhotomapDBSchema>> | undefined;

export function getDB(): Promise<IDBPDatabase<PhotomapDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PhotomapDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('photoMeta')) {
          db.createObjectStore('photoMeta', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('photoBlobs')) {
          db.createObjectStore('photoBlobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** Test-only helper to force a fresh DB connection (fake-indexeddb resets between tests). */
export function resetDBConnectionForTests(): void {
  dbPromise = undefined;
}
