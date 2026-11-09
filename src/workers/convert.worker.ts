import { convert3mfToStl, convertStlEncoding, convertStlTo3mf } from '../core/convert';
import type { StlEncoding, StlEncodingOptions, StlTo3mfOptions, ThreeMfToStlOptions } from '../core/convert';

export type ConvertWorkerRequest =
  | { action: '3mf-to-stl'; buffer: ArrayBuffer; options: ThreeMfToStlOptions }
  | { action: 'stl-to-3mf'; buffer: ArrayBuffer; options: StlTo3mfOptions }
  | { action: 'stl-encoding'; buffer: ArrayBuffer; options: StlEncodingOptions & { target?: StlEncoding | 'auto' } };

self.onmessage = (event: MessageEvent<ConvertWorkerRequest>) => {
  const msg = event.data;
  if (msg.action === '3mf-to-stl') {
    self.postMessage({ action: msg.action, result: convert3mfToStl(msg.buffer, msg.options) });
  } else if (msg.action === 'stl-to-3mf') {
    self.postMessage({ action: msg.action, result: convertStlTo3mf(msg.buffer, msg.options) });
  } else if (msg.action === 'stl-encoding') {
    self.postMessage({ action: msg.action, result: convertStlEncoding(msg.buffer, msg.options) });
  }
};
