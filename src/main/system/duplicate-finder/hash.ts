import fs from 'fs';
import crypto from 'crypto';

/**
 * Hashing constants per D-DF-3:
 * - SHA-256 algorithm
 * - Threshold for partial hash prefilter: 10 MB
 * - Head and tail read window: 4 KB each
 * - Streaming chunk size: 64 KB
 */
export const DEFAULT_PARTIAL_HASH_THRESHOLD_BYTES = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_HASH_WINDOW_BYTES = 4 * 1024; // 4 KB
export const STREAM_CHUNK_SIZE_BYTES = 64 * 1024; // 64 KB

/**
 * Computes full SHA-256 hash of a file by streaming in 64 KB chunks.
 * Memory usage remains flat regardless of file size.
 * Rejects if the file cannot be read (e.g. locked, access denied).
 */
export function computeFullHash(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_SIZE_BYTES });

    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk);
    });

    stream.on('error', (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    stream.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(hash.digest('hex'));
      }
    });
  });
}

/**
 * Computes a partial SHA-256 hash of the head and tail (4 KB head + 4 KB tail).
 * Used only as a prefilter for files above the threshold to avoid reading full files.
 * Rejects if the file cannot be read.
 */
export async function computePartialHash(
  filePath: string,
  fileSize: number,
  windowBytes: number = DEFAULT_HASH_WINDOW_BYTES
): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const hash = crypto.createHash('sha256');

    // Read head
    const headSize = Math.min(windowBytes, fileSize);
    if (headSize > 0) {
      const headBuf = Buffer.alloc(headSize);
      const { bytesRead: headRead } = await handle.read(headBuf, 0, headSize, 0);
      hash.update(headBuf.subarray(0, headRead));
    }

    // Read tail (if file has bytes beyond the head)
    if (fileSize > headSize) {
      const tailSize = Math.min(windowBytes, fileSize - headSize);
      const tailOffset = fileSize - tailSize;
      const tailBuf = Buffer.alloc(tailSize);
      const { bytesRead: tailRead } = await handle.read(tailBuf, 0, tailSize, tailOffset);
      hash.update(tailBuf.subarray(0, tailRead));
    }

    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
