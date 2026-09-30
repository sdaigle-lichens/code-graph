import type { CodeGraphApi } from "../shared/ipc.js";

declare global {
  interface Window {
    codeGraph: CodeGraphApi;
  }
}

export {};
