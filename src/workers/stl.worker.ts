import { auditStl, repairStl, Triangle } from '../core/stl';

export type StlWorkerRequest =
  | { action: 'audit'; buffer: ArrayBuffer }
  | { action: 'repair'; triangles: Triangle[] };

self.onmessage = (event: MessageEvent<StlWorkerRequest>) => {
  const msg = event.data;
  if (msg.action === 'audit') {
    const res = auditStl(msg.buffer);
    self.postMessage({ action: 'audit', result: res });
  } else if (msg.action === 'repair') {
    const res = repairStl(msg.triangles);
    self.postMessage({ action: 'repair', result: res });
  }
};
