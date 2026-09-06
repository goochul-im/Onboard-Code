import { analyzeBrowserFiles } from "./core/analyzer";
import type { BrowserSourceFile } from "./core/types";

type WorkerRequest = {
  id: string;
  type: "analyze";
  files: BrowserSourceFile[];
  wasmBaseUrl?: string;
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "analyze") return;
  try {
    const result = await analyzeBrowserFiles(request.files, request.wasmBaseUrl ?? `${import.meta.env.BASE_URL}wasm`);
    self.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: request.id, ok: false, error: (error as Error).message });
  }
};
