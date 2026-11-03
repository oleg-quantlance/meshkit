import { convertStepToStl, StepConvertOptions } from '../core/step';

export interface StepWorkerRequest {
  buffer: ArrayBuffer;
  options?: StepConvertOptions;
}

self.onmessage = (event: MessageEvent<StepWorkerRequest>) => {
  const { buffer, options } = event.data;
  const result = convertStepToStl(buffer, options);
  self.postMessage(result);
};
