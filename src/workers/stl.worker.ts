import { auditStl, repairStlWithManifoldWasm, Triangle } from '../core/stl';

export type StlWorkerRequest =
  | { action: 'audit'; buffer: ArrayBuffer }
  | { action: 'repair'; triangles: Triangle[] };

self.onmessage = async (event: MessageEvent<StlWorkerRequest>) => {
  const msg = event.data;
  if (msg.action === 'audit') {
    const res = auditStl(msg.buffer);
    self.postMessage({ action: 'audit', result: res });
  } else if (msg.action === 'repair') {
    const res = await repairStlWithManifoldWasm(msg.triangles);
    self.postMessage({ action: 'repair', result: res });
  }
};
