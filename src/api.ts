import { DEFAULT_SETTINGS } from "./defaults";
import type {
  AppSettings,
  AuthStartResult,
  DeadlineItem,
  DeadlineRadarApi,
  LarkCheckResult,
  ParseTextInput,
  ParseTextResult,
  SyncItemResult
} from "./types";

const settingsKey = "deadline-radar.preview.settings";
const itemsKey = "deadline-radar.preview.items";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): T {
  localStorage.setItem(key, JSON.stringify(value, null, 2));
  return value;
}

function createPreviewItem(input: ParseTextInput): DeadlineItem {
  const now = new Date();
  const deadline = new Date(now.getTime() + 26 * 60 * 60 * 1000);
  const iso = deadline.toISOString();
  const id = crypto.randomUUID();

  return {
    id,
    title: "演示事项：确认活动报名截止",
    description: "浏览器预览模式下生成的样例事项。Electron 运行时会调用真实模型解析。",
    source: {
      type: "text",
      title: input.sourceTitle || "粘贴文本",
      url: input.sourceUrl || "",
      rawExcerpt: input.text.slice(0, 140)
    },
    deadline: {
      value: iso,
      timezone: input.settings.lark.timezone,
      isAllDay: false,
      precision: "relative",
      rawText: "明天"
    },
    risk: {
      level: "high",
      reason: "距离截止时间约 1 天，建议尽快处理。",
      timelineBucket: "tomorrow"
    },
    timeState: "active",
    nextAction: "确认是否需要报名，并补充必要材料。",
    confidence: 0.76,
    status: "pending",
    pushStatus: "pending",
    reminders: [{ minutes: 1560 }, { minutes: 120 }],
    calendarSync: {
      calendarId: null,
      eventId: null,
      idempotencyKey: `deadline-radar-${id}`,
      lastSyncedAt: null,
      lastError: null
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

const browserPreviewApi: DeadlineRadarApi = {
  async getSettings() {
    return readLocal(settingsKey, DEFAULT_SETTINGS);
  },
  async saveSettings(settings: AppSettings) {
    return writeLocal(settingsKey, settings);
  },
  async listItems() {
    return readLocal<DeadlineItem[]>(itemsKey, []);
  },
  async saveItems(items: DeadlineItem[]) {
    return writeLocal(itemsKey, items);
  },
  async parseText(input: ParseTextInput): Promise<ParseTextResult> {
    return {
      items: [createPreviewItem(input)],
      warnings: ["当前是浏览器预览模式，未调用 Electron 主进程和真实模型。"]
    };
  },
  async checkLarkCli(): Promise<LarkCheckResult> {
    return {
      cliFound: false,
      version: null,
      doctorOk: false,
      identityReady: false,
      userCalendarReady: false,
      userAuthMissing: true,
      scopeMissing: false,
      message: "浏览器预览模式无法调用本机 lark-cli，请在 Electron 中检测。",
      raw: null
    };
  },
  async startLarkAuth(): Promise<AuthStartResult> {
    return {
      ok: false,
      message: "浏览器预览模式无法启动 lark-cli 授权。"
    };
  },
  async syncItem(item: DeadlineItem): Promise<SyncItemResult> {
    return {
      item: {
        ...item,
        pushStatus: "failed",
        calendarSync: {
          ...item.calendarSync,
          lastError: "浏览器预览模式无法同步飞书日历。"
        }
      },
      calendarCreated: false,
      message: "浏览器预览模式无法同步飞书日历。"
    };
  },
  async getAppInfo() {
    return {
      version: "preview",
      dataPath: "localStorage"
    };
  }
};

export function getDeadlineRadarApi(): DeadlineRadarApi {
  return window.deadlineRadar ?? browserPreviewApi;
}
