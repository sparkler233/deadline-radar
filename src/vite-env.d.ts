/// <reference types="vite/client" />

import type { DeadlineRadarApi } from "./types";

declare global {
  interface Window {
    deadlineRadar?: DeadlineRadarApi;
  }
}
