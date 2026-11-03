import { convertStepToStlWithOcctWasm, StepConvertOptions } from '../core/step';

export interface StepWorkerRequest {
  buffer: ArrayBuffer;
  options?: StepConvertOptions;
}

self.onmessage = async (event: MessageEvent<StepWorkerRequest>) => {
  const { buffer, options } = event.data;
  const result = await convertStepToStlWithOcctWasm(buffer, options);
  self.postMessage(result);
};
