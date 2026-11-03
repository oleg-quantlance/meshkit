import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FILE_LIMITS,
  validateFileMetadata,
  validateTextBufferHead,
} from '../../src/core/validate';
import { parseGcode } from '../../src/core/gcode';
import { auditStl, exportBinaryStl } from '../../src/core/stl';
import { convertStepToStl } from '../../src/core/step';

const truncatedAsciiStl = readFileSync(
  new URL('../fixtures/truncated-ascii.stl', import.meta.url),
  'utf-8'
);
const noSolidStep = readFileSync(
  new URL('../fixtures/no-solid.step', import.meta.url),
  'utf-8'
);
const validStep = readFileSync(
  new URL('../../public/samples/planetary-gear-housing.step', import.meta.url),
  'utf-8'
);

// Fake PNG header bytes (\x89PNG\r\n\x1a\n\x00...)
const fakePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

describe('File Handling Fixtures & Validation Rules (F1–F12)', () => {
  it('F1: 0-byte .gcode / .stl / .step rejected with empty message', () => {
    for (const [ext, kind] of [
      ['part.gcode', 'gcode'],
      ['part.stl', 'stl'],
      ['part.step', 'step'],
    ] as const) {
      const res = validateFileMetadata({ name: ext, size: 0 }, kind);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errorCode).toBe('empty');
        expect(res.error).toContain('0 bytes');
      }
    }
  });

  it('F2: photo.png dropped on each tool -> wrong-type message naming accepted extension', () => {
    const rGcode = validateFileMetadata({ name: 'photo.png', size: 1024 }, 'gcode');
    expect(rGcode.ok).toBe(false);
    if (!rGcode.ok) {
      expect(rGcode.errorCode).toBe('wrong_type');
      expect(rGcode.error).toBe('This tool accepts .gcode files. You selected a .png file.');
    }

    const rStl = validateFileMetadata({ name: 'photo.png', size: 1024 }, 'stl');
    expect(rStl.ok).toBe(false);
    if (!rStl.ok) {
      expect(rStl.error).toBe('This tool accepts .stl files. You selected a .png file.');
    }

    const rStep = validateFileMetadata({ name: 'photo.png', size: 1024 }, 'step');
    expect(rStep.ok).toBe(false);
    if (!rStep.ok) {
      expect(rStep.error).toBe('This tool accepts .step files. You selected a .png file.');
    }
  });

  it('F3: PNG renamed to part.gcode and part.stl -> rejected as corrupt', () => {
    const gcodeHead = validateTextBufferHead(fakePngBytes, 'gcode');
    expect(gcodeHead.ok).toBe(false);
    if (!gcodeHead.ok) {
      expect(gcodeHead.error).toContain('does not contain G-code');
    }

    const stlRes = auditStl(fakePngBytes);
    expect(stlRes.ok).toBe(false);
    if (!stlRes.ok) {
      expect(stlRes.errorCode).toBe('corrupt');
    }
  });

  it('F4: Files 1 byte over each limit rejected before reading', () => {
    const overGcode = validateFileMetadata(
      { name: 'huge.gcode', size: FILE_LIMITS.gcode + 1 },
      'gcode'
    );
    expect(overGcode.ok).toBe(false);
    if (!overGcode.ok) expect(overGcode.errorCode).toBe('too_large');

    const overStl = validateFileMetadata(
      { name: 'huge.stl', size: FILE_LIMITS.stl + 1 },
      'stl'
    );
    expect(overStl.ok).toBe(false);
    if (!overStl.ok) expect(overStl.errorCode).toBe('too_large');

    const overStep = validateFileMetadata(
      { name: 'huge.step', size: FILE_LIMITS.step + 1 },
      'step'
    );
    expect(overStep.ok).toBe(false);
    if (!overStep.ok) expect(overStep.errorCode).toBe('too_large');
  });

  it('F5: G-code with comments only; CRLF vs LF; G20 inches converted to mm', () => {
    const commentsOnly = parseGcode('; slicer header\n; no G0/G1 moves\n');
    expect(commentsOnly.ok).toBe(false);
    if (!commentsOnly.ok) expect(commentsOnly.errorCode).toBe('no_geometry');

    const lf = parseGcode('G21\nM82\nG1 X10 Y10 E4.2\nG1 X20 Y20 E8.4\n');
    const crlf = parseGcode('G21\r\nM82\r\nG1 X10 Y10 E4.2\r\nG1 X20 Y20 E8.4\r\n');
    expect(lf.ok && crlf.ok).toBe(true);
    if (lf.ok && crlf.ok) {
      expect(crlf.filamentMm).toBeCloseTo(lf.filamentMm, 5);
      expect(crlf.filamentGrams).toBeCloseTo(lf.filamentGrams, 5);
    }

    const g20 = parseGcode('G20\nM82\nG1 X1.0 E1.0\n');
    expect(g20.ok && g20.filamentMm).toBeCloseTo(25.4, 3);
  });

  it('F6: Binary STL whose header says 1,000 triangles but holds 12 -> incomplete or damaged with counts', () => {
    const buf = new ArrayBuffer(84 + 50 * 12);
    const dv = new DataView(buf);
    dv.setUint32(80, 1000, true);
    const res = auditStl(buf);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorCode).toBe('corrupt');
      expect(res.error).toContain('expected 1,000 triangles, found 12');
    }
  });

  it('F7: Binary STL whose header starts with "solid" is parsed as binary', () => {
    const bin = exportBinaryStl([
      {
        v0: { x: 0, y: 0, z: 0 },
        v1: { x: 10, y: 0, z: 0 },
        v2: { x: 0, y: 10, z: 0 },
      },
    ]);
    const bytes = new Uint8Array(bin);
    const solidPrefix = 'solid binary_header_test';
    for (let i = 0; i < solidPrefix.length; i++) {
      bytes[i] = solidPrefix.charCodeAt(i);
    }

    const res = auditStl(bytes);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.metrics.format).toBe('binary');
      expect(res.metrics.triangleCount).toBe(1);
    }
  });

  it('F8: ASCII STL cut off mid-facet & STL containing NaN rejected with descriptive error', () => {
    const cutRes = auditStl(truncatedAsciiStl);
    expect(cutRes.ok).toBe(false);
    if (!cutRes.ok) {
      expect(cutRes.error).toContain('incomplete or cut off');
    }

    const nanAscii = `solid nan_test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 NaN\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid nan_test`;
    const nanRes = auditStl(nanAscii);
    expect(nanRes.ok).toBe(false);
    if (!nanRes.ok) {
      expect(nanRes.error).toContain('NaN');
    }
  });

  it('F9: STEP without ISO-10303-21 header; STEP header with no solid; and valid STEP conversion', () => {
    const noHeader = convertStepToStl('HEADER;\nDATA;\nENDSEC;');
    expect(noHeader.ok).toBe(false);
    if (!noHeader.ok) expect(noHeader.errorCode).toBe('corrupt');

    const noSolid = convertStepToStl(noSolidStep);
    expect(noSolid.ok).toBe(false);
    if (!noSolid.ok) expect(noSolid.errorCode).toBe('no_geometry');

    const okStep = convertStepToStl(validStep, {
      linearDeflectionMm: 0.02,
      units: 'mm',
      outputFormat: 'binary',
    });
    expect(okStep.ok).toBe(true);
    if (okStep.ok) {
      expect(okStep.solidCount).toBeGreaterThanOrEqual(1);
      expect(okStep.triangleCount).toBeGreaterThan(0);
      expect(okStep.binaryStl.byteLength).toBe(84 + 50 * okStep.triangleCount);
      expect(okStep.bbox.sizeX).toBeGreaterThan(0);
      expect(okStep.bbox.sizeY).toBeGreaterThan(0);
      expect(okStep.bbox.sizeZ).toBeGreaterThan(0);
    }
  });

  it('F10: Two files dropped at once -> first file used with notice; folder dropped -> rejected', () => {
    const multi = validateFileMetadata(
      [
        { name: 'part.stl', size: 684 },
        { name: 'second.stl', size: 684 },
      ],
      'stl'
    );
    expect(multi.ok).toBe(true);
    if (multi.ok) {
      expect(multi.file.name).toBe('part.stl');
      expect(multi.notice).toBe('Only one file at a time. Using: part.stl');
    }

    const folder = validateFileMetadata(
      [{ name: 'models_folder', size: 0, isDirectory: true }],
      'stl'
    );
    expect(folder.ok).toBe(false);
    if (!folder.ok) expect(folder.errorCode).toBe('folder_rejected');
  });
});
