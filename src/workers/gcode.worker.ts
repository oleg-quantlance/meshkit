import { parseGcode, GcodeParseOptions } from '../core/gcode';

export interface GcodeWorkerRequest {
  text: string;
  options?: GcodeParseOptions;
}

self.onmessage = (event: MessageEvent<GcodeWorkerRequest>) => {
  const { text, options } = event.data;
  const result = parseGcode(text, options);
  self.postMessage(result);
};
