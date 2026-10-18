import path from 'path';
import { DiskFileType } from '../../../shared/types';

/**
 * Extension-to-category map for DiskAnalyzer (v1 fixed in code, per OQ-10).
 * All extensions are stored with leading dot in lower case.
 */
export const EXTENSION_MAP: Readonly<Record<string, DiskFileType>> = Object.freeze({
  // Video
  '.mp4': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.mov': 'video',
  '.wmv': 'video',
  '.flv': 'video',
  '.webm': 'video',
  '.m4v': 'video',
  '.mpg': 'video',
  '.mpeg': 'video',
  '.3gp': 'video',

  // Audio
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
  '.ogg': 'audio',
  '.wma': 'audio',
  '.m4a': 'audio',
  '.opus': 'audio',

  // Image
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.tiff': 'image',
  '.tif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.ico': 'image',
  '.heic': 'image',

  // Document
  '.doc': 'document',
  '.docx': 'document',
  '.pdf': 'document',
  '.txt': 'document',
  '.rtf': 'document',
  '.odt': 'document',
  '.xls': 'document',
  '.xlsx': 'document',
  '.ppt': 'document',
  '.pptx': 'document',
  '.csv': 'document',
  '.md': 'document',
  '.log': 'document',

  // Archive
  '.zip': 'archive',
  '.rar': 'archive',
  '.7z': 'archive',
  '.tar': 'archive',
  '.gz': 'archive',
  '.bz2': 'archive',
  '.xz': 'archive',
  '.iso': 'archive',
  '.cab': 'archive',

  // System
  '.exe': 'system',
  '.dll': 'system',
  '.sys': 'system',
  '.drv': 'system',
  '.ocx': 'system',
  '.bat': 'system',
  '.cmd': 'system',
  '.msi': 'system',
  '.ps1': 'system',
  '.vbs': 'system',
  '.jar': 'system',
});

/**
 * Metadata (labels, theme colors) for each file category.
 */
export const CATEGORY_METADATA: Readonly<Record<DiskFileType, { label: string; color: string }>> = Object.freeze({
  video: { label: 'Videos & Movies', color: '#f59e0b' },
  audio: { label: 'Audio & Music', color: '#06b6d4' },
  image: { label: 'Photos & Graphics', color: '#8b5cf6' },
  document: { label: 'Documents & Text', color: '#10b981' },
  archive: { label: 'Archives & Packages', color: '#ec4899' },
  system: { label: 'Windows & System Files', color: '#3b82f6' },
  other: { label: 'Other / Unknown', color: '#64748b' },
});

/**
 * Maps a file extension or path to its corresponding category.
 * - Unknown extensions map to 'other'.
 * - Empty string or files without extension map to 'other'.
 * - Case-insensitive matching (e.g. .JPG === .jpg).
 * - No filesystem access.
 */
export function extensionToCategory(extOrPath: string): DiskFileType {
  if (!extOrPath || typeof extOrPath !== 'string') {
    return 'other';
  }

  const trimmed = extOrPath.trim();
  if (!trimmed || trimmed === '.') {
    return 'other';
  }

  let ext = '';
  // Check if caller passed a bare extension with leading dot and no path separators (e.g. '.mp4', '.MP4')
  if (
    trimmed.startsWith('.') &&
    !trimmed.slice(1).includes('.') &&
    !trimmed.includes('/') &&
    !trimmed.includes('\\')
  ) {
    ext = trimmed;
  } else {
    ext = path.extname(trimmed);
    // If extname returned empty, check if it's a bare extension without leading dot (e.g. 'mp4', 'MP4')
    if (!ext && !trimmed.includes('/') && !trimmed.includes('\\')) {
      ext = `.${trimmed}`;
    }
  }

  if (!ext || ext === '.') {
    return 'other';
  }

  const lowerExt = ext.toLowerCase();
  return EXTENSION_MAP[lowerExt] || 'other';
}
