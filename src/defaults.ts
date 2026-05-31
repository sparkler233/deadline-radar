import type { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  model: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    temperature: 0.2,
    timeoutMs: 45000,
    language: "zh-CN"
  },
  lark: {
    cliPath: "lark-cli",
    calendarName: "Deadline 雷达",
    timezone: "Asia/Shanghai",
    reminderRules: {
      high: [1560, 120],
      medium: [1440],
      watch: [360],
      low: [120]
    }
  },
  ui: {
    density: "comfortable"
  }
};
