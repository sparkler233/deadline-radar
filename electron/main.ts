import { app, BrowserWindow, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

type RiskLevel = "high" | "medium" | "watch" | "low" | "unknown";
type TimelineBucket = "today" | "tomorrow" | "within_3_days" | "within_5_days" | "later" | "unscheduled";
type TimeState = "overdue" | "active" | "no_deadline";

interface AppSettings {
  model: {
    baseUrl: string;
    model: string;
    temperature: number;
    timeoutMs: number;
    language: string;
  };
  lark: {
    cliPath: string;
    calendarName: string;
    timezone: string;
    reminderRules: Record<"high" | "medium" | "watch" | "low", number[]>;
  };
  ui: {
    density: "comfortable" | "compact";
  };
}

interface DeadlineItem {
  id: string;
  title: string;
  description: string;
  source: {
    type: "text" | "feishu_doc" | "feishu_wiki" | "web";
    title: string;
    url: string;
    rawExcerpt: string;
  };
  deadline: {
    value: string | null;
    timezone: string;
    isAllDay: boolean;
    precision: "exact" | "date" | "relative" | "range" | "unknown";
    rawText: string;
  };
  risk: {
    level: RiskLevel;
    reason: string;
    timelineBucket: TimelineBucket;
  };
  timeState: TimeState;
  nextAction: string;
  confidence: number;
  status: "pending" | "confirmed" | "done" | "deleted";
  pushStatus: "pending" | "synced" | "failed" | "not_pushable";
  reminders: Array<{ minutes: number }>;
  calendarSync: {
    calendarId: string | null;
    eventId: string | null;
    idempotencyKey: string;
    lastSyncedAt: string | null;
    lastError: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

interface ParseTextInput {
  text: string;
  sourceTitle: string;
  sourceUrl: string;
  apiKey: string;
  settings: AppSettings;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

const defaultSettings: AppSettings = {
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

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "Deadline 雷达",
    backgroundColor: "#f4f7f5",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function dataDir() {
  return path.join(app.getPath("userData"), "data");
}

async function ensureDataDir() {
  await fs.mkdir(dataDir(), { recursive: true });
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const filePath = path.join(dataDir(), fileName);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeJson<T>(fileName: string, value: T): Promise<T> {
  await ensureDataDir();
  await fs.writeFile(path.join(dataDir(), fileName), JSON.stringify(value, null, 2), "utf8");
  return value;
}

function mergeSettings(settings?: Partial<AppSettings>): AppSettings {
  return {
    model: {
      ...defaultSettings.model,
      ...(settings?.model ?? {})
    },
    lark: {
      ...defaultSettings.lark,
      ...(settings?.lark ?? {}),
      reminderRules: {
        ...defaultSettings.lark.reminderRules,
        ...(settings?.lark?.reminderRules ?? {})
      }
    },
    ui: {
      ...defaultSettings.ui,
      ...(settings?.ui ?? {})
    }
  };
}

function registerIpcHandlers() {
  ipcMain.handle("settings:get", async () => {
    const stored = await readJson<Partial<AppSettings>>("settings.json", defaultSettings);
    return mergeSettings(stored);
  });

  ipcMain.handle("settings:save", async (_event, settings: AppSettings) => {
    const sanitized = mergeSettings(settings);
    return writeJson("settings.json", sanitized);
  });

  ipcMain.handle("items:list", async () => readJson<DeadlineItem[]>("items.json", []));

  ipcMain.handle("items:save", async (_event, items: DeadlineItem[]) => {
    const visibleItems = Array.isArray(items) ? items : [];
    await writeJson(
      "sync-queue.json",
      visibleItems.filter((item) => item.status !== "deleted" && item.status !== "done" && (item.pushStatus === "pending" || item.pushStatus === "failed"))
    );
    return writeJson("items.json", visibleItems);
  });

  ipcMain.handle("parser:parse-text", async (_event, input: ParseTextInput) => parseTextWithModel(input));

  ipcMain.handle("lark:check", async (_event, settings: AppSettings) => checkLarkCli(mergeSettings(settings)));

  ipcMain.handle("lark:start-auth", async (_event, settings: AppSettings) => startLarkAuth(mergeSettings(settings)));

  ipcMain.handle("lark:sync-item", async (_event, item: DeadlineItem, settings: AppSettings) => {
    try {
      return await syncItemToLark(item, mergeSettings(settings));
    } catch (error) {
      const now = new Date().toISOString();
      const failedItem: DeadlineItem = {
        ...item,
        pushStatus: "failed",
        updatedAt: now,
        calendarSync: {
          ...item.calendarSync,
          lastError: getErrorMessage(error)
        }
      };
      return {
        item: failedItem,
        calendarCreated: false,
        message: getErrorMessage(error)
      };
    }
  });

  ipcMain.handle("app:info", async () => ({
    version: app.getVersion(),
    dataPath: dataDir()
  }));
}

async function parseTextWithModel(input: ParseTextInput) {
  const settings = mergeSettings(input.settings);
  const normalizedInput = input.text?.trim()
    ? input
    : input.sourceUrl?.trim()
      ? await hydrateInputFromSourceUrl(input, settings)
      : input;

  if (!normalizedInput.text?.trim()) {
    throw new Error("请输入需要解析的文本，或填写一个可读取的飞书文档链接。");
  }
  if (!input.apiKey?.trim()) {
    throw new Error("请先在设置页填写 API Key。");
  }

  const rawItems = await callOpenAiCompatibleParser(normalizedInput, settings);
  const items = rawItems.map((raw, index) => normalizeParsedItem(raw, normalizedInput, settings, index));

  return {
    items,
    warnings: items.length === 0 ? ["模型没有返回可执行事项。"] : []
  };
}

async function hydrateInputFromSourceUrl(input: ParseTextInput, settings: AppSettings): Promise<ParseTextInput> {
  const sourceUrl = input.sourceUrl.trim();
  if (!/feishu\.cn|larksuite\.com|larkoffice\.com/i.test(sourceUrl)) {
    throw new Error("当前直读链接只支持飞书文档。普通网页链接请先粘贴正文。");
  }

  const cli = settings.lark.cliPath || "lark-cli";
  const output = await runCommand(cli, ["docs", "+fetch", "--api-version", "v1", "--as", "user", "--doc", sourceUrl], 45000);
  const raw = parseCommandJson(output.stdout);
  const markdown = stringOr(raw?.data?.markdown, raw?.markdown);
  const title = stringOr(raw?.data?.title, input.sourceTitle || "飞书文档");
  if (!markdown.trim()) {
    throw new Error("飞书文档读取成功，但没有获取到可解析正文。");
  }

  return {
    ...input,
    text: markdown,
    sourceTitle: input.sourceTitle || title
  };
}

async function callOpenAiCompatibleParser(input: ParseTextInput, settings: AppSettings): Promise<unknown[]> {
  const baseUrl = settings.model.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;
  const messages = [
    {
      role: "system",
      content:
        "你是 Deadline 雷达的信息解析器。只输出 JSON，不要输出 Markdown。你需要从中文或英文文本中提取可执行事项。"
    },
    {
      role: "user",
      content: [
        `当前时间：${new Date().toISOString()}`,
        `默认时区：${settings.lark.timezone}`,
        `输出语言：${settings.model.language}`,
        `来源标题：${input.sourceTitle || "粘贴文本"}`,
        `来源链接：${input.sourceUrl || ""}`,
        "",
        "请输出如下 JSON 对象：",
        '{"items":[{"title":"","description":"","deadline":{"value":null,"timezone":"Asia/Shanghai","isAllDay":false,"precision":"unknown","rawText":""},"risk":{"level":"unknown","reason":"","timelineBucket":"unscheduled"},"nextAction":"","confidence":0.5,"sourceExcerpt":""}]}',
        "",
        "字段要求：",
        "- deadline.value 使用 ISO 8601 字符串；如果没有明确时间，必须为 null。",
        "- risk.level 只能是 high、medium、watch、low、unknown。",
        "- timelineBucket 只能是 today、tomorrow、within_3_days、within_5_days、later、unscheduled。",
        "- confidence 是 0 到 1 的数字。",
        "- sourceExcerpt 保留能证明该事项的原文片段。",
        "",
        "待解析文本：",
        input.text
      ].join("\n")
    }
  ];

  const baseBody = {
    model: settings.model.model,
    temperature: settings.model.temperature,
    messages
  };

  const response = await postChatCompletion(url, input.apiKey, settings.model.timeoutMs, {
    ...baseBody,
    response_format: { type: "json_object" }
  }).catch(async (error) => {
    const message = getErrorMessage(error);
    if (message.includes("response_format") || message.includes("json_object")) {
      return postChatCompletion(url, input.apiKey, settings.model.timeoutMs, baseBody);
    }
    throw error;
  });

  const content = response?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("模型响应中没有可解析的文本内容。");
  }

  const parsed = parseJsonFromText(content);
  const items = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(items)) {
    throw new Error("模型返回格式不正确：缺少 items 数组。");
  }
  return items;
}

async function postChatCompletion(url: string, apiKey: string, timeoutMs: number, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(timeoutMs, 5000));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`模型请求失败：HTTP ${response.status} ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonFromText(content: string): any {
  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("无法从模型响应中解析 JSON。");
  }
}

function normalizeParsedItem(raw: any, input: ParseTextInput, settings: AppSettings, index: number): DeadlineItem {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const deadlineValue = typeof raw?.deadline?.value === "string" && raw.deadline.value.trim() ? raw.deadline.value.trim() : null;
  const precision = pickValue(raw?.deadline?.precision, ["exact", "date", "relative", "range", "unknown"], deadlineValue ? "exact" : "unknown");
  const confidence = clampNumber(Number(raw?.confidence), 0, 1, 0.5);
  const temporal = computeTemporalState(deadlineValue, confidence);
  const riskLevel = temporal.timeState === "overdue" || temporal.timeState === "no_deadline"
    ? "unknown"
    : pickValue(raw?.risk?.level, ["high", "medium", "watch", "low", "unknown"], temporal.riskLevel);
  const reminders = temporal.timeState === "no_deadline" ? [] : (settings.lark.reminderRules[riskLevel as Exclude<RiskLevel, "unknown">] ?? []).map((minutes) => ({ minutes }));

  return {
    id,
    title: stringOr(raw?.title, `未命名事项 ${index + 1}`),
    description: stringOr(raw?.description, ""),
    source: {
      type: "text",
      title: input.sourceTitle || "粘贴文本",
      url: input.sourceUrl || "",
      rawExcerpt: stringOr(raw?.sourceExcerpt, input.text.slice(0, 240))
    },
    deadline: {
      value: temporal.timeState === "no_deadline" ? null : deadlineValue,
      timezone: stringOr(raw?.deadline?.timezone, settings.lark.timezone),
      isAllDay: Boolean(raw?.deadline?.isAllDay),
      precision: temporal.timeState === "no_deadline" ? "unknown" : precision,
      rawText: stringOr(raw?.deadline?.rawText, "")
    },
    risk: {
      level: riskLevel,
      reason: stringOr(raw?.risk?.reason, temporal.reason),
      timelineBucket: temporal.timelineBucket
    },
    timeState: temporal.timeState,
    nextAction: stringOr(raw?.nextAction, "确认事项是否需要处理，并补充缺失信息。"),
    confidence,
    status: confidence < 0.7 ? "pending" : "pending",
    pushStatus: temporal.timeState === "no_deadline" ? "not_pushable" : "pending",
    reminders,
    calendarSync: {
      calendarId: null,
      eventId: null,
      idempotencyKey: `deadline-radar-${id}`,
      lastSyncedAt: null,
      lastError: null
    },
    createdAt: now,
    updatedAt: now
  };
}

function computeTemporalState(value: string | null, confidence: number): {
  timeState: TimeState;
  timelineBucket: TimelineBucket;
  riskLevel: RiskLevel;
  reason: string;
} {
  if (!value) {
    return {
      timeState: "no_deadline",
      timelineBucket: "unscheduled",
      riskLevel: "unknown",
      reason: "未识别到明确截止时间。"
    };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      timeState: "no_deadline",
      timelineBucket: "unscheduled",
      riskLevel: "unknown",
      reason: "时间字段无法解析，需要手动确认。"
    };
  }

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / 86400000;

  if (diffMs < 0) {
    return {
      timeState: "overdue",
      timelineBucket: "today",
      riskLevel: "unknown",
      reason: "事项已经超过截止时间。"
    };
  }

  const bucket = getTimelineBucket(date, now, diffDays);
  if (confidence < 0.7) {
    return {
      timeState: "active",
      timelineBucket: bucket,
      riskLevel: "watch",
      reason: "模型置信度偏低，建议人工确认。"
    };
  }

  if (diffDays <= 1.5) {
    return {
      timeState: "active",
      timelineBucket: bucket,
      riskLevel: "high",
      reason: "距离截止时间不足 36 小时。"
    };
  }
  if (diffDays <= 3) {
    return {
      timeState: "active",
      timelineBucket: bucket,
      riskLevel: "medium",
      reason: "截止时间在 3 天内。"
    };
  }
  if (diffDays <= 5) {
    return {
      timeState: "active",
      timelineBucket: bucket,
      riskLevel: "watch",
      reason: "截止时间在 5 天内，可以开始准备。"
    };
  }
  return {
    timeState: "active",
    timelineBucket: bucket,
    riskLevel: "low",
    reason: "截止时间较远，暂时保持观察。"
  };
}

function getTimelineBucket(date: Date, now: Date, diffDays: number): TimelineBucket {
  if (sameLocalDate(date, now)) {
    return "today";
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameLocalDate(date, tomorrow)) {
    return "tomorrow";
  }
  if (diffDays <= 3) {
    return "within_3_days";
  }
  if (diffDays <= 5) {
    return "within_5_days";
  }
  return "later";
}

function sameLocalDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

async function checkLarkCli(settings: AppSettings) {
  const cli = settings.lark.cliPath || "lark-cli";
  const result = {
    cliFound: false,
    version: null as string | null,
    doctorOk: false,
    identityReady: false,
    userCalendarReady: false,
    userAuthMissing: false,
    scopeMissing: false,
    message: "",
    raw: null as unknown
  };

  try {
    const version = await runCommand(cli, ["--version"], 5000);
    result.cliFound = true;
    result.version = version.stdout.trim() || version.stderr.trim();
  } catch (error) {
    result.message = `未找到或无法运行 lark-cli：${getErrorMessage(error)}`;
    result.raw = serializeError(error);
    return result;
  }

  try {
    const doctor = await runCommand(cli, ["doctor"], 30000);
    const raw = parseCommandJson(doctor.stdout);
    result.raw = raw;
    result.doctorOk = Boolean(raw?.ok);
    result.identityReady = Array.isArray(raw?.checks)
      ? raw.checks.some((check: any) => check.name === "identity_ready" && check.status === "pass")
      : false;
  } catch (error) {
    result.raw = serializeError(error);
    result.message = `lark-cli doctor 未通过：${getErrorMessage(error)}`;
  }

  try {
    await runCommand(cli, ["calendar", "calendars", "list", "--as", "user", "--params", "{\"page_size\":50}"], 30000);
    result.userCalendarReady = true;
    result.message = "飞书 CLI 已可用，user 身份可以读取日历。";
  } catch (error) {
    const message = getErrorMessage(error);
    result.userAuthMissing = message.includes("need_user_authorization") || message.includes("missing") || message.includes("no token");
    result.scopeMissing = message.includes("scope") || message.includes("99991672");
    result.message = result.userAuthMissing
      ? "已找到 lark-cli，但 user 身份还没有完成 calendar 授权。"
      : `日历读取验证失败：${message}`;
    result.raw = result.raw ?? serializeError(error);
  }

  return result;
}

async function startLarkAuth(settings: AppSettings) {
  const cli = settings.lark.cliPath || "lark-cli";
  try {
    const output = await runCommand(cli, ["auth", "login", "--domain", "calendar", "--no-wait", "--json"], 30000);
    const raw = parseCommandJson(output.stdout);
    const verificationUrl =
      raw?.verification_uri_complete || raw?.verification_url || raw?.verification_uri || raw?.url || undefined;
    if (verificationUrl) {
      void shell.openExternal(verificationUrl);
    }

    const deviceCode = raw?.device_code;
    if (!deviceCode) {
      return {
        ok: true,
        message: verificationUrl ? "已打开飞书授权页；授权后请再次检测飞书 CLI。" : "已启动飞书授权，请按命令返回信息继续。",
        verificationUrl,
        userCode: raw?.user_code,
        deviceCode,
        raw
      };
    }

    const completion = await runCommand(cli, ["auth", "login", "--device-code", deviceCode, "--json"], 180000);
    const completionRaw = parseCommandJson(completion.stdout);
    const check = await checkLarkCli(settings);

    return {
      ok: check.userCalendarReady,
      message: check.userCalendarReady
        ? "飞书 Calendar 授权已完成，user 身份可以读取日历。"
        : `授权流程已结束，但日历读取仍未通过：${check.message}`,
      verificationUrl,
      userCode: raw?.user_code,
      deviceCode,
      raw: {
        start: raw,
        completion: completionRaw,
        check
      }
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      ok: false,
      message: message.includes("timed out")
        ? "飞书授权等待超时。请重新点击启动授权，并在打开的页面完成确认。"
        : message,
      raw: serializeError(error)
    };
  }
}

async function syncItemToLark(item: DeadlineItem, settings: AppSettings) {
  if (!item.deadline.value) {
    const updated = {
      ...item,
      pushStatus: "not_pushable" as const,
      calendarSync: {
        ...item.calendarSync,
        lastError: "缺少明确截止时间，不能同步日历。"
      }
    };
    return {
      item: updated,
      calendarCreated: false,
      message: "缺少明确截止时间，不能同步日历。"
    };
  }

  const calendar = await ensureDeadlineCalendar(settings);
  const eventPayload = createEventPayload(item, settings);
  const cli = settings.lark.cliPath || "lark-cli";
  const idempotencyKey = item.calendarSync.idempotencyKey || `deadline-radar-${item.id}`;
  const output = await runCommand(
    cli,
    [
      "calendar",
      "events",
      "create",
      "--as",
      "user",
      "--params",
      JSON.stringify({ calendar_id: calendar.calendarId, idempotency_key: idempotencyKey }),
      "--data",
      JSON.stringify(eventPayload)
    ],
    45000
  );
  const raw = parseCommandJson(output.stdout);
  const event = raw?.event ?? raw?.data?.event ?? raw;
  const now = new Date().toISOString();

  const updated: DeadlineItem = {
    ...item,
    status: "confirmed",
    pushStatus: "synced",
    updatedAt: now,
    calendarSync: {
      calendarId: calendar.calendarId,
      eventId: event?.event_id ?? event?.id ?? null,
      idempotencyKey,
      lastSyncedAt: now,
      lastError: null
    }
  };

  return {
    item: updated,
    calendarCreated: calendar.created,
    message: calendar.created ? "已创建专用日历并同步事项。" : "已同步到专用飞书日历。"
  };
}

async function ensureDeadlineCalendar(settings: AppSettings): Promise<{ calendarId: string; created: boolean }> {
  const cli = settings.lark.cliPath || "lark-cli";
  const calendarName = settings.lark.calendarName || "Deadline 雷达";
  const listOutput = await runCommand(
    cli,
    ["calendar", "calendars", "list", "--as", "user", "--page-all", "--params", "{\"page_size\":50}"],
    45000
  );
  const listRaw = parseCommandJson(listOutput.stdout);
  const calendars = listRaw?.calendar_list ?? listRaw?.data?.calendar_list ?? listRaw?.items ?? [];
  const existing = Array.isArray(calendars)
    ? calendars.find((calendar: any) => !calendar.is_deleted && (calendar.summary === calendarName || calendar.summary_alias === calendarName))
    : null;

  if (existing?.calendar_id) {
    return {
      calendarId: existing.calendar_id,
      created: false
    };
  }

  const createOutput = await runCommand(
    cli,
    [
      "calendar",
      "calendars",
      "create",
      "--as",
      "user",
      "--data",
      JSON.stringify({
        summary: calendarName,
        description: "Deadline 雷达专用日历",
        permissions: "private"
      })
    ],
    45000
  );
  const createRaw = parseCommandJson(createOutput.stdout);
  const calendar = createRaw?.calendar ?? createRaw?.data?.calendar ?? createRaw;
  if (!calendar?.calendar_id) {
    throw new Error("专用日历创建成功但未返回 calendar_id。");
  }
  return {
    calendarId: calendar.calendar_id,
    created: true
  };
}

function createEventPayload(item: DeadlineItem, settings: AppSettings) {
  const description = [
    item.description,
    "",
    `下一步：${item.nextAction}`,
    `风险原因：${item.risk.reason}`,
    item.source.url ? `来源：${item.source.title} ${item.source.url}` : `来源：${item.source.title}`,
    item.source.rawExcerpt ? `原文片段：${item.source.rawExcerpt}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  if (item.deadline.isAllDay) {
    const date = item.deadline.value?.slice(0, 10);
    if (!date) {
      throw new Error("全天事项缺少日期。");
    }
    const end = new Date(`${date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      summary: item.title,
      description,
      start_time: { date },
      end_time: { date: end.toISOString().slice(0, 10) },
      visibility: "private",
      free_busy_status: "free",
      reminders: item.reminders,
      source: "deadline-radar"
    };
  }

  const start = new Date(item.deadline.value ?? "");
  if (Number.isNaN(start.getTime())) {
    throw new Error("截止时间无法解析，不能创建日程。");
  }
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return {
    summary: item.title,
    description,
    start_time: {
      timestamp: Math.floor(start.getTime() / 1000).toString(),
      timezone: item.deadline.timezone || settings.lark.timezone
    },
    end_time: {
      timestamp: Math.floor(end.getTime() / 1000).toString(),
      timezone: item.deadline.timezone || settings.lark.timezone
    },
    visibility: "private",
    free_busy_status: "free",
    reminders: item.reminders,
    source: "deadline-radar"
  };
}

function runCommand(file: string, args: string[], timeout: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

function parseCommandJson(stdout: string): any {
  const cleaned = stdout.trim().replace(/^=== Dry Run ===\s*/i, "");
  if (!cleaned) {
    return null;
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error(`命令输出不是 JSON：${cleaned.slice(0, 300)}`);
  }
}

function serializeError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const err = error as any;
  return {
    message: err.message,
    code: err.code,
    stdout: err.stdout,
    stderr: err.stderr
  };
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const err = error as any;
  const stdout = typeof err.stdout === "string" ? err.stdout.trim() : "";
  if (stdout) {
    try {
      const parsed = parseCommandJson(stdout);
      return parsed?.error?.message || parsed?.error?.hint || parsed?.message || stdout;
    } catch {
      return stdout;
    }
  }
  if (typeof err.stderr === "string" && err.stderr.trim()) {
    return err.stderr.trim();
  }
  return err.message || "未知错误";
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function pickValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}
