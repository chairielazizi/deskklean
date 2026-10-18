import {
  DiskFileType,
  FileTypeBreakdown,
  DiskFolderNode,
  LargeFileInfo,
  SkippedPath,
  DiskAnalysisResult,
} from '../../../shared/types';
import { CATEGORY_METADATA } from './categorize';

export interface LargeFileCandidate {
  name: string;
  path: string;
  sizeBytes: number;
  extension: string;
  lastModified: string;
}

/**
 * Recursively propagates child sizes and file counts up the directory tree,
 * computes percentages relative to scannedBytes, sorts child folders descending by size,
 * and ensures the root node's sizeBytes strictly equals scannedBytes and root.percentage is 100.
 */
export function finalizeFolderTree(root: DiskFolderNode, scannedBytes: number): void {
  function traverse(node: DiskFolderNode): void {
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        traverse(child);
        node.sizeBytes += child.sizeBytes;
        node.fileCount += child.fileCount;
      }
      // Sort children by size descending for clean presentation
      node.children.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else {
      // Leaf node without subdirectories
      node.children = undefined;
    }
  }

  function assignPercentages(node: DiskFolderNode): void {
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        child.percentage =
          scannedBytes > 0
            ? Math.round((child.sizeBytes / scannedBytes) * 1000) / 10
            : 0;
        assignPercentages(child);
      }
    }
  }

  traverse(root);

  // Honesty rule: Root sizeBytes strictly equals scannedBytes
  root.sizeBytes = scannedBytes;
  root.percentage = 100;

  assignPercentages(root);
}

/**
 * Builds the FileTypeBreakdown array for all 7 standard DiskFileType categories.
 * Percentages are calculated relative to scannedBytes.
 * Sorted descending by totalBytes.
 */
export function buildFileTypeBreakdown(
  categoryStats: Map<DiskFileType, { totalBytes: number; count: number }>,
  scannedBytes: number
): FileTypeBreakdown[] {
  const allTypes: DiskFileType[] = [
    'video',
    'audio',
    'image',
    'document',
    'archive',
    'system',
    'other',
  ];

  const breakdown: FileTypeBreakdown[] = allTypes.map((type) => {
    const meta = CATEGORY_METADATA[type];
    const stats = categoryStats.get(type) || { totalBytes: 0, count: 0 };
    const percentage =
      scannedBytes > 0
        ? Math.round((stats.totalBytes / scannedBytes) * 1000) / 10
        : 0;

    return {
      type,
      label: meta.label,
      totalBytes: stats.totalBytes,
      percentage,
      color: meta.color,
      count: stats.count,
    };
  });

  breakdown.sort((a, b) => b.totalBytes - a.totalBytes);
  return breakdown;
}

/**
 * Sorts file candidates by sizeBytes descending, takes the top N (default 50, per OQ-9),
 * and assigns stable IDs.
 */
export function finalizeLargeFiles(
  candidates: LargeFileCandidate[],
  maxN: number = 50
): LargeFileInfo[] {
  const sorted = [...candidates].sort((a, b) => b.sizeBytes - a.sizeBytes);
  const top = sorted.slice(0, Math.max(0, maxN));

  return top.map((file, idx) => ({
    id: `lf-${idx + 1}`,
    name: file.name,
    path: file.path,
    sizeBytes: file.sizeBytes,
    extension: file.extension,
    lastModified: file.lastModified,
  }));
}

export interface AssembleResultParams {
  rootPath: string;
  driveTotalBytes: number | null;
  driveFreeBytes: number | null;
  scannedBytes: number;
  fileCount: number;
  directoryCount: number;
  folderTree: DiskFolderNode;
  largeFiles: LargeFileInfo[];
  breakdown: FileTypeBreakdown[];
  skippedPaths: SkippedPath[];
  scanDurationMs: number;
  complete: boolean;
}

/**
 * Assembles the full DiskAnalysisResult object.
 */
export function assembleDiskAnalysisResult(params: AssembleResultParams): DiskAnalysisResult {
  return {
    rootPath: params.rootPath,
    driveTotalBytes: params.driveTotalBytes,
    driveFreeBytes: params.driveFreeBytes,
    scannedBytes: params.scannedBytes,
    fileCount: params.fileCount,
    directoryCount: params.directoryCount,
    folderTree: params.folderTree,
    largeFiles: params.largeFiles,
    breakdown: params.breakdown,
    skippedPaths: params.skippedPaths,
    scanDurationMs: params.scanDurationMs,
    complete: params.complete,
  };
}
