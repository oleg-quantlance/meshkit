export const FILE_LIMITS = {
  gcode: 150 * 1024 * 1024, // 150 MB
  stl: 100 * 1024 * 1024,   // 100 MB
  step: 50 * 1024 * 1024,   // 50 MB
  threemf: 100 * 1024 * 1024, // 100 MB (zip; expands in memory)
  obj: 100 * 1024 * 1024,
  mesh: 100 * 1024 * 1024, // viewer: any of stl / 3mf / obj
} as const;

export const ACCEPTED_EXTENSIONS: Record<ToolFileKind, string[]> = {
  gcode: ['.gcode', '.gco', '.g'],
  stl: ['.stl'],
  step: ['.step', '.stp'],
  threemf: ['.3mf'],
  obj: ['.obj'],
  mesh: ['.stl', '.3mf', '.obj'],
};

export type ToolFileKind = 'gcode' | 'stl' | 'step' | 'threemf' | 'obj' | 'mesh';

export type ValidationErrorCode =
  | 'empty'
  | 'wrong_type'
  | 'too_large'
  | 'corrupt'
  | 'no_geometry'
  | 'folder_rejected'
  | 'lib_failed'
  | 'timeout';

export interface FileMetadataLike {
  name: string;
  size: number;
  isDirectory?: boolean;
}

export type FileValidationResult =
  | {
      ok: true;
      file: FileMetadataLike;
      notice?: string;
    }
  | {
      ok: false;
      errorCode: ValidationErrorCode;
      error: string;
    };

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot < 0) return '';
  return filename.slice(lastDot).toLowerCase();
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Validates file selection list (handles multiple files and folders) and
 * runs Section 6 checks in exact order:
 * 1. Folder / multiple check
 * 2. Empty (0 bytes)
 * 3. Extension
 * 4. Size limit (before reading any bytes)
 */
export function validateFileMetadata(
  files: FileMetadataLike[] | FileMetadataLike,
  kind: ToolFileKind
): FileValidationResult {
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 0) {
    return {
      ok: false,
      errorCode: 'empty',
      error: 'No file selected.',
    };
  }

  const first = list[0];
  if (first.isDirectory) {
    return {
      ok: false,
      errorCode: 'folder_rejected',
      error: 'Folders cannot be uploaded. Please choose a single file.',
    };
  }

  const notice =
    list.length > 1 ? `Only one file at a time. Using: ${first.name}` : undefined;

  // 1. Empty check
  if (first.size === 0) {
    return {
      ok: false,
      errorCode: 'empty',
      error: 'This file is empty (0 bytes). Please choose another file.',
    };
  }

  // 2. Extension check
  const ext = getExtension(first.name);
  const allowed = ACCEPTED_EXTENSIONS[kind];
  if (!allowed.includes(ext)) {
    const shownExt = ext || 'unknown';
    const primaryExt = allowed[0];
    return {
      ok: false,
      errorCode: 'wrong_type',
      error: `This tool accepts ${primaryExt} files. You selected a ${shownExt} file.`,
    };
  }

  // 3. Size limit check (before reading bytes)
  const limitBytes = FILE_LIMITS[kind];
  if (first.size > limitBytes) {
    return {
      ok: false,
      errorCode: 'too_large',
      error: `This file is ${formatMb(first.size)}; the limit is ${formatMb(limitBytes)}. Try exporting with fewer details.`,
    };
  }

  return {
    ok: true,
    file: first,
    notice,
  };
}

/**
 * Checks the first 64 KB of a text-based file (G-code or STEP) for NUL bytes
 * or binary magic headers (such as PNG \x89PNG).
 */
export function validateTextBufferHead(
  buffer: ArrayBuffer | Uint8Array | string,
  kind: 'gcode' | 'step'
): { ok: true; textHead: string } | { ok: false; errorCode: 'corrupt'; error: string } {
  let bytes: Uint8Array;
  if (typeof buffer === 'string') {
    if (buffer.slice(0, 65536).includes('\0')) {
      return {
        ok: false,
        errorCode: 'corrupt',
        error:
          kind === 'gcode'
            ? 'This file has a .gcode name but does not contain G-code.'
            : 'This file has a .step name but does not contain STEP data.',
      };
    }
    const textHead = buffer.slice(0, 65536);
    if (kind === 'step' && !textHead.trimStart().startsWith('ISO-10303-21;')) {
      return {
        ok: false,
        errorCode: 'corrupt',
        error: 'This file has a .step name but does not begin with an ISO-10303-21; header.',
      };
    }
    return { ok: true, textHead };
  }

  bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const checkLen = Math.min(bytes.byteLength, 65536);

  // Check for PNG magic bytes or NUL bytes
  if (
    checkLen >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      ok: false,
      errorCode: 'corrupt',
      error:
        kind === 'gcode'
          ? 'This file has a .gcode name but does not contain G-code.'
          : 'This file has a .step name but does not contain STEP data.',
    };
  }

  for (let i = 0; i < checkLen; i++) {
    if (bytes[i] === 0) {
      return {
        ok: false,
        errorCode: 'corrupt',
        error:
          kind === 'gcode'
            ? 'This file has a .gcode name but does not contain G-code.'
            : 'This file has a .step name but does not contain STEP data.',
      };
    }
  }

  const textHead = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, checkLen));
  if (kind === 'step' && !textHead.trimStart().startsWith('ISO-10303-21;')) {
    return {
      ok: false,
      errorCode: 'corrupt',
      error: 'This file has a .step name but does not begin with an ISO-10303-21; header.',
    };
  }

  return { ok: true, textHead };
}

export const WORKER_TIMEOUT_MS = 60_000;

export function getLibraryFailureMessage(): string {
  return 'The converter could not start. Check your connection and retry.';
}

export function getWorkerTimeoutMessage(): string {
  return 'This file is taking too long. Cancel or keep waiting?';
}
