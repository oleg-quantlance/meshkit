import { MAX_SAFE_INPUT } from './format';

export interface ToolpathPoint {
  x: number;
  y: number;
  z: number;
  extruding: boolean;
}

export interface GcodeParseOptions {
  densityGPerCm3?: number;
  diameterMm?: number;
  defaultAccelerationMmPerS2?: number;
  maxPointsPerLayer?: number;
}

export type GcodeParseResult =
  | {
      ok: true;
      moveCount: number;
      layerCount: number;
      filamentMm: number;
      filamentMeters: number;
      filamentGrams: number;
      headerGrams: number | null;
      printSeconds: number;
      printHours: number;
      timeSource: 'slicer_header' | 'kinematic_estimate';
      layers: ToolpathPoint[][];
      bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      } | null;
    }
  | {
      ok: false;
      errorCode: 'empty' | 'corrupt' | 'no_geometry' | 'invalid_params';
      error: string;
    };

function parseCoord(cmd: string, axis: string): number | null {
  const re = new RegExp(`(?:^|\\s)${axis}([-+]?\\d*\\.?\\d+)`, 'i');
  const m = cmd.match(re);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return Number.isFinite(val) ? val : null;
}

function computeTrapezoidalSeconds(distanceMm: number, speedMmPerS: number, accelMmPerS2: number): number {
  if (distanceMm <= 0 || speedMmPerS <= 0) return 0;
  if (accelMmPerS2 <= 0) return distanceMm / speedMmPerS;
  const accelDist = (speedMmPerS * speedMmPerS) / accelMmPerS2;
  if (distanceMm >= accelDist) {
    const cruiseDist = distanceMm - accelDist;
    return (2 * speedMmPerS) / accelMmPerS2 + cruiseDist / speedMmPerS;
  }
  const peakSpeed = Math.sqrt(distanceMm * accelMmPerS2);
  return (2 * peakSpeed) / accelMmPerS2;
}

export function filamentMmToGrams(filamentMm: number, densityGPerCm3: number, diameterMm: number): number {
  if (filamentMm <= 0 || densityGPerCm3 <= 0 || diameterMm <= 0) return 0;
  const rCm = diameterMm / 10 / 2;
  const areaCm2 = Math.PI * rCm * rCm;
  const lengthCm = filamentMm / 10;
  return lengthCm * areaCm2 * densityGPerCm3;
}

export function parseGcode(text: string, options: GcodeParseOptions = {}): GcodeParseResult {
  const {
    densityGPerCm3 = 1.24,
    diameterMm = 1.75,
    defaultAccelerationMmPerS2 = 1500,
    maxPointsPerLayer = 2000,
  } = options;

  if (
    !Number.isFinite(densityGPerCm3) ||
    !Number.isFinite(diameterMm) ||
    densityGPerCm3 <= 0 ||
    diameterMm <= 0 ||
    densityGPerCm3 >= MAX_SAFE_INPUT ||
    diameterMm >= MAX_SAFE_INPUT
  ) {
    return {
      ok: false,
      errorCode: 'invalid_params',
      error: 'Filament density and diameter must be above zero.',
    };
  }

  if (!text || text.length === 0) {
    return {
      ok: false,
      errorCode: 'empty',
      error: 'This file is empty (0 bytes). Please choose another file.',
    };
  }

  const headCheck = text.slice(0, 65536);
  if (headCheck.includes('\0')) {
    return {
      ok: false,
      errorCode: 'corrupt',
      error: 'This file has a .gcode name but does not contain G-code.',
    };
  }

  const lines = text.split(/\r?\n/);

  let unitScale = 1.0; // G21 = 1.0 (mm), G20 = 25.4 (inch -> mm)
  let absXYZ = true;   // G90 = true, G91 = false
  let absE = true;     // M82 = true, M83 = false
  let curX = 0;
  let curY = 0;
  let curZ = 0;
  let curE = 0;
  let feedMmPerMin = 1800; // 30 mm/s default
  let accelMmPerS2 = defaultAccelerationMmPerS2;

  let moveCount = 0;
  let commentLayerCount = 0;
  let netExtrusionMm = 0;
  let kinematicSeconds = 0;
  let headerSeconds: number | null = null;
  let headerGrams: number | null = null;

  const rawLayers: ToolpathPoint[][] = [];
  let currentLayer: ToolpathPoint[] = [];
  let lastLayerZ: number | null = null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;

    const semiIdx = rawLine.indexOf(';');
    const cmdPart = (semiIdx >= 0 ? rawLine.slice(0, semiIdx) : rawLine).trim();
    const commentPart = semiIdx >= 0 ? rawLine.slice(semiIdx + 1).trim() : '';

    if (commentPart) {
      if (commentPart.startsWith('LAYER:') || commentPart.startsWith('CHANGE_LAYER')) {
        commentLayerCount++;
      } else if (commentPart.startsWith('TIME:')) {
        const secs = parseFloat(commentPart.slice(5).trim());
        if (Number.isFinite(secs) && secs > 0) {
          headerSeconds = secs;
        }
      } else if (commentPart.includes('estimated printing time')) {
        const dMatch = commentPart.match(/(\d+)\s*d/);
        const hMatch = commentPart.match(/(\d+)\s*h/);
        const mMatch = commentPart.match(/(\d+)\s*m/);
        const sMatch = commentPart.match(/(\d+)\s*s/);
        const totalSecs =
          (dMatch ? parseInt(dMatch[1], 10) * 86400 : 0) +
          (hMatch ? parseInt(hMatch[1], 10) * 3600 : 0) +
          (mMatch ? parseInt(mMatch[1], 10) * 60 : 0) +
          (sMatch ? parseInt(sMatch[1], 10) : 0);
        if (totalSecs > 0) {
          headerSeconds = totalSecs;
        }
      } else if (commentPart.includes('filament used [g]')) {
        const gMatch = commentPart.match(/=\s*([\d.]+)/);
        if (gMatch) {
          const gVal = parseFloat(gMatch[1]);
          if (Number.isFinite(gVal) && gVal > 0) {
            headerGrams = gVal;
          }
        }
      }
    }

    if (!cmdPart) continue;

    const firstToken = cmdPart.split(/\s+/)[0].toUpperCase();

    if (firstToken === 'G20') {
      unitScale = 25.4;
    } else if (firstToken === 'G21') {
      unitScale = 1.0;
    } else if (firstToken === 'G90') {
      absXYZ = true;
    } else if (firstToken === 'G91') {
      absXYZ = false;
    } else if (firstToken === 'M82') {
      absE = true;
    } else if (firstToken === 'M83') {
      absE = false;
    } else if (firstToken === 'M204') {
      const pVal = parseCoord(cmdPart, 'P') ?? parseCoord(cmdPart, 'S');
      if (pVal !== null && pVal > 0) {
        accelMmPerS2 = pVal * unitScale;
      }
    } else if (firstToken === 'G92') {
      const xVal = parseCoord(cmdPart, 'X');
      const yVal = parseCoord(cmdPart, 'Y');
      const zVal = parseCoord(cmdPart, 'Z');
      const eVal = parseCoord(cmdPart, 'E');
      const hasAny = xVal !== null || yVal !== null || zVal !== null || eVal !== null;
      if (!hasAny) {
        curX = 0;
        curY = 0;
        curZ = 0;
        curE = 0;
      } else {
        if (xVal !== null) curX = xVal * unitScale;
        if (yVal !== null) curY = yVal * unitScale;
        if (zVal !== null) curZ = zVal * unitScale;
        if (eVal !== null) curE = eVal * unitScale;
      }
    } else if (firstToken === 'G0' || firstToken === 'G1' || firstToken === 'G00' || firstToken === 'G01') {
      moveCount++;
      const xVal = parseCoord(cmdPart, 'X');
      const yVal = parseCoord(cmdPart, 'Y');
      const zVal = parseCoord(cmdPart, 'Z');
      const eVal = parseCoord(cmdPart, 'E');
      const fVal = parseCoord(cmdPart, 'F');

      if (fVal !== null && fVal > 0) {
        feedMmPerMin = fVal * unitScale;
      }

      const nextX = xVal !== null ? (absXYZ ? xVal * unitScale : curX + xVal * unitScale) : curX;
      const nextY = yVal !== null ? (absXYZ ? yVal * unitScale : curY + yVal * unitScale) : curY;
      const nextZ = zVal !== null ? (absXYZ ? zVal * unitScale : curZ + zVal * unitScale) : curZ;

      let deltaE = 0;
      if (eVal !== null) {
        const scaledE = eVal * unitScale;
        if (absE) {
          deltaE = scaledE - curE;
          curE = scaledE;
        } else {
          deltaE = scaledE;
          curE += scaledE;
        }
        netExtrusionMm += deltaE;
      }

      const dx = nextX - curX;
      const dy = nextY - curY;
      const dz = nextZ - curZ;
      const distXYZ = Math.hypot(dx, dy, dz);
      const moveDist = distXYZ > 0 ? distXYZ : Math.abs(deltaE);
      const speedMmPerS = feedMmPerMin / 60;
      kinematicSeconds += computeTrapezoidalSeconds(moveDist, speedMmPerS, accelMmPerS2);

      const hasXY = xVal !== null || yVal !== null;
      if (hasXY) {
        if (lastLayerZ === null || Math.abs(nextZ - lastLayerZ) > 1e-4) {
          if (currentLayer.length > 0) {
            rawLayers.push(currentLayer);
          }
          currentLayer = [{ x: curX, y: curY, z: nextZ, extruding: false }];
          lastLayerZ = nextZ;
        }
        currentLayer.push({
          x: nextX,
          y: nextY,
          z: nextZ,
          extruding: deltaE > 0,
        });

        if (nextX < minX) minX = nextX;
        if (nextX > maxX) maxX = nextX;
        if (nextY < minY) minY = nextY;
        if (nextY > maxY) maxY = nextY;
        if (nextZ < minZ) minZ = nextZ;
        if (nextZ > maxZ) maxZ = nextZ;
      }

      curX = nextX;
      curY = nextY;
      curZ = nextZ;
    }
  }

  if (currentLayer.length > 1) {
    rawLayers.push(currentLayer);
  }

  if (moveCount === 0) {
    return {
      ok: false,
      errorCode: 'no_geometry',
      error: 'No printable moves were found in this G-code.',
    };
  }

  const sampledLayers: ToolpathPoint[][] = rawLayers.map((layer) => {
    if (layer.length <= maxPointsPerLayer) return layer;
    const step = (layer.length - 1) / (maxPointsPerLayer - 1);
    const sampled: ToolpathPoint[] = [];
    for (let k = 0; k < maxPointsPerLayer; k++) {
      sampled.push(layer[Math.round(k * step)]);
    }
    return sampled;
  });

  const filamentMm = Math.max(0, netExtrusionMm);
  const computedGrams = filamentMmToGrams(filamentMm, densityGPerCm3, diameterMm);
  const filamentGrams = filamentMm > 0 ? computedGrams : (headerGrams ?? 0);
  const rCm = diameterMm / 10 / 2;
  const gramsPerMeter = Math.PI * rCm * rCm * 100 * densityGPerCm3;
  const filamentMeters = filamentMm > 0 ? filamentMm / 1000 : (gramsPerMeter > 0 ? filamentGrams / gramsPerMeter : 0);

  const timeSource = headerSeconds !== null ? 'slicer_header' : 'kinematic_estimate';
  const printSeconds = headerSeconds !== null ? headerSeconds : kinematicSeconds;
  const printHours = printSeconds / 3600;
  const layerCount = Math.max(commentLayerCount, sampledLayers.length);

  const bounds =
    Number.isFinite(minX) && Number.isFinite(maxX)
      ? { minX, maxX, minY, maxY, minZ, maxZ }
      : null;

  return {
    ok: true,
    moveCount,
    layerCount,
    filamentMm,
    filamentMeters,
    filamentGrams,
    headerGrams,
    printSeconds,
    printHours,
    timeSource,
    layers: sampledLayers,
    bounds,
  };
}
