export type SourceType = "text" | "feishu_doc" | "feishu_wiki" | "web";
export type DeadlinePrecision = "exact" | "date" | "relative" | "range" | "unknown";
export type RiskLevel = "high" | "medium" | "watch" | "low" | "unknown";
export type TimelineBucket =
  | "today"
  | "tomorrow"
  | "within_3_days"
  | "within_5_days"
  | "later"
  | "unscheduled";
export type TimeState = "overdue" | "active" | "no_deadline";
export type ItemStatus = "pending" | "confirmed" | "done" | "deleted";
export type PushStatus = "pending" | "synced" | "failed" | "not_pushable";

export interface DeadlineSource {
  type: SourceType;
  title: string;
  url: string;
  rawExcerpt: string;
}

export interface DeadlineTime {
  value: string | null;
  timezone: string;
  isAllDay: boolean;
  precision: DeadlinePrecision;
  rawText: string;
}

export interface DeadlineRisk {
  level: RiskLevel;
  reason: string;
  timelineBucket: TimelineBucket;
}

export interface Reminder {
  minutes: number;
}

export interface CalendarSyncState {
  calendarId: string | null;
  eventId: string | null;
  idempotencyKey: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface DeadlineItem {
  id: string;
  title: string;
  description: string;
  source: DeadlineSource;
  deadline: DeadlineTime;
  risk: DeadlineRisk;
  timeState: TimeState;
  nextAction: string;
  confidence: number;
  status: ItemStatus;
  pushStatus: PushStatus;
  reminders: Reminder[];
  calendarSync: CalendarSyncState;
  createdAt: string;
  updatedAt: string;
}

export interface ModelSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  language: string;
}

export interface LarkSettings {
  cliPath: string;
  calendarName: string;
  timezone: string;
  reminderRules: Record<Exclude<RiskLevel, "unknown">, number[]>;
}

export interface UiSettings {
  density: "comfortable" | "compact";
}

export interface AppSettings {
  model: ModelSettings;
  lark: LarkSettings;
  ui: UiSettings;
}

export interface ParseTextInput {
  text: string;
  sourceTitle: string;
  sourceUrl: string;
  apiKey: string;
  settings: AppSettings;
}

export interface ParseTextResult {
  items: DeadlineItem[];
  warnings: string[];
}

export interface LarkCheckResult {
  cliFound: boolean;
  version: string | null;
  doctorOk: boolean;
  identityReady: boolean;
  userCalendarReady: boolean;
  userAuthMissing: boolean;
  scopeMissing: boolean;
  message: string;
  raw: unknown;
}

export interface AuthStartResult {
  ok: boolean;
  message: string;
  verificationUrl?: string;
  userCode?: string;
  deviceCode?: string;
  raw?: unknown;
}

export interface SyncItemResult {
  item: DeadlineItem;
  calendarCreated: boolean;
  message: string;
}

export interface DeadlineRadarApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  listItems: () => Promise<DeadlineItem[]>;
  saveItems: (items: DeadlineItem[]) => Promise<DeadlineItem[]>;
  parseText: (input: ParseTextInput) => Promise<ParseTextResult>;
  checkLarkCli: (settings: AppSettings) => Promise<LarkCheckResult>;
  startLarkAuth: (settings: AppSettings) => Promise<AuthStartResult>;
  syncItem: (item: DeadlineItem, settings: AppSettings) => Promise<SyncItemResult>;
  getAppInfo: () => Promise<{ version: string; dataPath: string }>;
}
