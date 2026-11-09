import { convert3mfToStl, convertObjToStl, convertStlEncoding, convertStlTo3mf, loadMesh, transformScale, transformSimplify } from '../core/convert';
import type { ObjToStlOptions, StlEncoding, StlEncodingOptions, StlTo3mfOptions, ThreeMfToStlOptions } from '../core/convert';
import type { ScaleOptions } from '../core/scale';
import type { SimplifyOptions } from '../core/simplify';

export type ConvertWorkerRequest =
  | { action: '3mf-to-stl'; buffer: ArrayBuffer; options: ThreeMfToStlOptions }
  | { action: 'stl-to-3mf'; buffer: ArrayBuffer; options: StlTo3mfOptions }
  | { action: 'stl-encoding'; buffer: ArrayBuffer; options: StlEncodingOptions & { target?: StlEncoding | 'auto' } }
  | { action: 'obj-to-stl'; buffer: ArrayBuffer; options: ObjToStlOptions }
  | { action: 'load-mesh'; buffer: ArrayBuffer; options: { filename: string } }
  | { action: 'scale'; buffer: ArrayBuffer; options: ScaleOptions & { filename: string } }
  | { action: 'simplify'; buffer: ArrayBuffer; options: SimplifyOptions & { filename: string } };

self.onmessage = (event: MessageEvent<ConvertWorkerRequest>) => {
  const msg = event.data;
  switch (msg.action) {
    case '3mf-to-stl':
      self.postMessage({ action: msg.action, result: convert3mfToStl(msg.buffer, msg.options) });
      break;
    case 'stl-to-3mf':
      self.postMessage({ action: msg.action, result: convertStlTo3mf(msg.buffer, msg.options) });
      break;
    case 'stl-encoding':
      self.postMessage({ action: msg.action, result: convertStlEncoding(msg.buffer, msg.options) });
      break;
    case 'obj-to-stl':
      self.postMessage({ action: msg.action, result: convertObjToStl(msg.buffer, msg.options) });
      break;
    case 'scale':
      self.postMessage({ action: msg.action, result: transformScale(msg.options.filename, msg.buffer, msg.options) });
      break;
    case 'simplify':
      self.postMessage({ action: msg.action, result: transformSimplify(msg.options.filename, msg.buffer, msg.options) });
      break;
    case 'load-mesh': {
      const result = loadMesh(msg.options.filename, msg.buffer);
      if (result.ok) {
        // Ship a flat Float32Array (transferable) instead of 3 objects per triangle.
        const n = result.triangles.length;
        const positions = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const t = result.triangles[i];
          positions.set([t.v0.x, t.v0.y, t.v0.z, t.v1.x, t.v1.y, t.v1.z, t.v2.x, t.v2.y, t.v2.z], i * 9);
        }
        const { triangles: _drop, ...rest } = result;
        void _drop;
        (self as unknown as Worker).postMessage({ action: msg.action, result: { ...rest, positions } }, [positions.buffer]);
      } else {
        self.postMessage({ action: msg.action, result });
      }
      break;
    }
  }
};
