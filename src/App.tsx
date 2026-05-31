import {
  AlertTriangle,
  CalendarCheck,
  Check,
  Clock3,
  Cog,
  Database,
  ExternalLink,
  Eye,
  Flame,
  Gauge,
  ListChecks,
  Loader2,
  Radar,
  RefreshCw,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getDeadlineRadarApi } from "./api";
import { DEFAULT_SETTINGS } from "./defaults";
import type { AppSettings, DeadlineItem, LarkCheckResult, RiskLevel, TimeState, TimelineBucket } from "./types";

type ViewKey = "radar" | "items" | "settings";

const riskCopy: Record<RiskLevel, { label: string; className: string; icon: LucideIcon }> = {
  high: { label: "高风险", className: "badge-danger", icon: Flame },
  medium: { label: "中风险", className: "badge-warn", icon: Gauge },
  watch: { label: "观察", className: "badge-watch", icon: Eye },
  low: { label: "低风险", className: "badge-calm", icon: ShieldCheck },
  unknown: { label: "待确认", className: "badge-neutral", icon: AlertTriangle }
};

const timelineCopy: Record<TimelineBucket, string> = {
  today: "今天",
  tomorrow: "明天",
  within_3_days: "3 天内",
  within_5_days: "5 天内",
  later: "5 天后",
  unscheduled: "无明确时间"
};

const timeStateCopy: Record<TimeState, string> = {
  overdue: "已逾期",
  active: "进行中",
  no_deadline: "无明确时间"
};

export default function App() {
  const api = useMemo(() => getDeadlineRadarApi(), []);
  const [view, setView] = useState<ViewKey>("radar");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [items, setItems] = useState<DeadlineItem[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [draftText, setDraftText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isCheckingLark, setIsCheckingLark] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [larkStatus, setLarkStatus] = useState<LarkCheckResult | null>(null);
  const [appInfo, setAppInfo] = useState<{ version: string; dataPath: string } | null>(null);

  const activeItems = useMemo(() => items.filter((item) => item.status !== "deleted"), [items]);
  const actionableItems = useMemo(() => activeItems.filter((item) => item.status !== "done"), [activeItems]);
  const sortedItems = useMemo(() => [...activeItems].sort(compareItems), [activeItems]);
  const sortedActionableItems = useMemo(() => [...actionableItems].sort(compareItems), [actionableItems]);
  const isPreview = appInfo?.version === "preview";

  const stats = useMemo(() => {
    const overdue = actionableItems.filter((item) => item.timeState === "overdue").length;
    const high = actionableItems.filter((item) => item.timeState === "active" && item.risk.level === "high").length;
    const watch = actionableItems.filter((item) => item.risk.level === "watch" || item.confidence < 0.7).length;
    const unscheduled = actionableItems.filter((item) => item.timeState === "no_deadline").length;
    const queue = actionableItems.filter((item) => item.pushStatus === "pending" || item.pushStatus === "failed").length;
    return { overdue, high, watch, unscheduled, queue };
  }, [actionableItems]);

  useEffect(() => {
    void (async () => {
      const [storedSettings, storedItems, info] = await Promise.all([api.getSettings(), api.listItems(), api.getAppInfo()]);
      setSettings(storedSettings);
      setItems(storedItems);
      setAppInfo(info);
    })();
  }, [api]);

  async function persistItems(nextItems: DeadlineItem[]) {
    setItems(nextItems);
    await api.saveItems(nextItems);
  }

  async function handleParse() {
    if (!draftText.trim() && !sourceUrl.trim()) {
      setNotice("先粘贴一段包含 deadline 的文本，或填写一个飞书文档链接。");
      return;
    }
    if (!settings.model.baseUrl.trim() || !settings.model.model.trim()) {
      setNotice("请先在设置页补全模型 Base URL 和 Model。");
      setView("settings");
      return;
    }
    if (!apiKey.trim() && !isPreview) {
      setNotice("请先在设置页填写 API Key。");
      setView("settings");
      return;
    }

    setIsParsing(true);
    setNotice(draftText.trim() ? "" : "正在读取飞书文档并解析事项...");
    try {
      const result = await api.parseText({
        text: draftText,
        sourceTitle,
        sourceUrl,
        apiKey,
        settings
      });
      const next = [...result.items, ...items];
      await persistItems(next);
      setDraftText("");
      setNotice(result.warnings[0] ?? `已解析出 ${result.items.length} 个事项。`);
      setView("radar");
    } catch (error) {
      setNotice(getMessage(error));
    } finally {
      setIsParsing(false);
    }
  }

  async function updateItem(itemId: string, patch: Partial<DeadlineItem>) {
    const next = items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...patch,
            updatedAt: new Date().toISOString()
          }
        : item
    );
    await persistItems(next);
  }

  async function confirmItem(item: DeadlineItem) {
    await updateItem(item.id, {
      status: "confirmed",
      pushStatus: item.deadline.value ? "pending" : "not_pushable"
    });
  }

  async function completeItem(item: DeadlineItem) {
    await updateItem(item.id, { status: "done" });
  }

  async function deleteItem(item: DeadlineItem) {
    await updateItem(item.id, { status: "deleted" });
  }

  async function syncItem(item: DeadlineItem) {
    setSyncingId(item.id);
    setNotice("");
    try {
      const result = await api.syncItem(item, settings);
      const next = items.map((existing) => (existing.id === item.id ? result.item : existing));
      await persistItems(next);
      setNotice(result.message);
    } catch (error) {
      setNotice(getMessage(error));
    } finally {
      setSyncingId(null);
    }
  }

  async function saveSettings() {
    setIsSavingSettings(true);
    setNotice("");
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      setNotice("设置已保存。API Key 仅保存在当前运行会话。");
    } catch (error) {
      setNotice(getMessage(error));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function checkLarkCli() {
    setIsCheckingLark(true);
    setNotice("");
    try {
      const result = await api.checkLarkCli(settings);
      setLarkStatus(result);
      setNotice(result.message);
    } catch (error) {
      setNotice(getMessage(error));
    } finally {
      setIsCheckingLark(false);
    }
  }

  async function startAuth() {
    setIsAuthorizing(true);
    setNotice("已启动飞书授权，请在打开的页面完成确认；应用会继续等待 CLI 写入 user token。");
    try {
      const result = await api.startLarkAuth(settings);
      setNotice(result.message);
      if (result.ok) {
        const check = await api.checkLarkCli(settings);
        setLarkStatus(check);
      }
    } catch (error) {
      setNotice(getMessage(error));
    } finally {
      setIsAuthorizing(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--ink)]">
      <div className="app-grid">
        <aside className="sidebar">
          <div className="brand-lockup">
            <div className="brand-mark">
              <Radar size={22} />
            </div>
            <div>
              <p className="brand-kicker">Deadline</p>
              <h1>雷达</h1>
            </div>
          </div>

          <nav className="nav-stack" aria-label="主导航">
            <NavButton icon={Gauge} label="风险雷达" active={view === "radar"} onClick={() => setView("radar")} />
            <NavButton icon={ListChecks} label="事项队列" active={view === "items"} onClick={() => setView("items")} />
            <NavButton icon={SettingsIcon} label="设置" active={view === "settings"} onClick={() => setView("settings")} />
          </nav>

          <div className="sidebar-footer">
            <div className="mini-status">
              <Database size={16} />
              <span>{appInfo?.dataPath ?? "加载本地数据..."}</span>
            </div>
            <div className="mini-status">
              <CalendarCheck size={16} />
              <span>{larkStatus?.userCalendarReady ? "飞书日历就绪" : "飞书待检测"}</span>
            </div>
          </div>
        </aside>

        <main className="workspace">
          <header className="topbar">
            <div>
              <p className="eyebrow">本地优先 · 飞书日历同步</p>
              <h2>{view === "radar" ? "风险雷达" : view === "items" ? "事项队列" : "应用设置"}</h2>
            </div>
            <div className="topbar-actions">
              <StatusPill
                tone={apiKey || isPreview ? "ok" : "warn"}
                label={apiKey || isPreview ? "模型可解析" : "缺少 API Key"}
              />
              <StatusPill
                tone={larkStatus?.userCalendarReady ? "ok" : larkStatus ? "warn" : "idle"}
                label={isPreview ? "浏览器预览" : larkStatus?.userCalendarReady ? "飞书已连接" : larkStatus ? "飞书需授权" : "飞书未检测"}
              />
            </div>
          </header>

          {notice ? <div className="notice-strip">{notice}</div> : null}
          {isPreview ? <div className="notice-strip">当前是浏览器预览环境，只能检查界面；飞书 CLI 检测、授权和同步请在 Electron 桌面窗口中操作。</div> : null}

          {view === "radar" ? (
            <RadarView
              stats={stats}
              items={sortedActionableItems}
              draftText={draftText}
              sourceTitle={sourceTitle}
              sourceUrl={sourceUrl}
              isParsing={isParsing}
              syncingId={syncingId}
              onDraftText={setDraftText}
              onSourceTitle={setSourceTitle}
              onSourceUrl={setSourceUrl}
              onParse={handleParse}
              onConfirm={confirmItem}
              onDone={completeItem}
              onDelete={deleteItem}
              onSync={syncItem}
            />
          ) : null}

          {view === "items" ? (
            <ItemsView
              items={sortedItems}
              syncingId={syncingId}
              onConfirm={confirmItem}
              onDone={completeItem}
              onDelete={deleteItem}
              onSync={syncItem}
            />
          ) : null}

          {view === "settings" ? (
            <SettingsView
              settings={settings}
              apiKey={apiKey}
              larkStatus={larkStatus}
              isSaving={isSavingSettings}
              isChecking={isCheckingLark}
              isAuthorizing={isAuthorizing}
              onSettingsChange={setSettings}
              onApiKeyChange={setApiKey}
              onSave={saveSettings}
              onCheckLark={checkLarkCli}
              onStartAuth={startAuth}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function RadarView(props: {
  stats: { overdue: number; high: number; watch: number; unscheduled: number; queue: number };
  items: DeadlineItem[];
  draftText: string;
  sourceTitle: string;
  sourceUrl: string;
  isParsing: boolean;
  syncingId: string | null;
  onDraftText: (value: string) => void;
  onSourceTitle: (value: string) => void;
  onSourceUrl: (value: string) => void;
  onParse: () => void;
  onConfirm: (item: DeadlineItem) => void;
  onDone: (item: DeadlineItem) => void;
  onDelete: (item: DeadlineItem) => void;
  onSync: (item: DeadlineItem) => void;
}) {
  const groups = [
    { key: "overdue", title: "逾期", icon: AlertTriangle, items: props.items.filter((item) => item.timeState === "overdue") },
    { key: "high", title: "高风险", icon: Flame, items: props.items.filter((item) => item.timeState === "active" && item.risk.level === "high") },
    { key: "watch", title: "观察", icon: Eye, items: props.items.filter((item) => item.risk.level === "watch") },
    { key: "unscheduled", title: "无明确时间", icon: Clock3, items: props.items.filter((item) => item.timeState === "no_deadline") }
  ];

  return (
    <div className="radar-layout">
      <section className="input-zone">
        <div className="section-heading">
          <div>
            <p className="eyebrow">收件箱</p>
            <h3>粘贴通知文本</h3>
          </div>
          <Sparkles size={20} />
        </div>
        <textarea
          className="text-input"
          value={props.draftText}
          onChange={(event) => props.onDraftText(event.target.value)}
          placeholder="粘贴课程通知、活动安排、群公告或邮件正文..."
        />
        <div className="input-row">
          <input
            className="field"
            value={props.sourceTitle}
            onChange={(event) => props.onSourceTitle(event.target.value)}
            placeholder="来源标题，可选"
          />
          <input
            className="field"
            value={props.sourceUrl}
            onChange={(event) => props.onSourceUrl(event.target.value)}
            placeholder="来源链接，可选"
          />
        </div>
        <button className="primary-button" onClick={props.onParse} disabled={props.isParsing} title="调用模型解析文本">
          {props.isParsing ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
          <span>{props.isParsing ? "解析中" : "解析事项"}</span>
        </button>
      </section>

      <section className="metrics-band" aria-label="风险概览">
        <Metric icon={AlertTriangle} label="逾期" value={props.stats.overdue} tone="danger" />
        <Metric icon={Flame} label="高风险" value={props.stats.high} tone="hot" />
        <Metric icon={Eye} label="观察" value={props.stats.watch} tone="watch" />
        <Metric icon={Clock3} label="无时间" value={props.stats.unscheduled} tone="muted" />
        <Metric icon={Send} label="推送队列" value={props.stats.queue} tone="calm" />
      </section>

      <section className="radar-board">
        {groups.map((group) => (
          <div className="radar-lane" key={group.key}>
            <div className="lane-heading">
              <group.icon size={18} />
              <span>{group.title}</span>
              <strong>{group.items.length}</strong>
            </div>
            <div className="lane-list">
              {group.items.length ? (
                group.items.slice(0, 3).map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    syncing={props.syncingId === item.id}
                    compact
                    onConfirm={props.onConfirm}
                    onDone={props.onDone}
                    onDelete={props.onDelete}
                    onSync={props.onSync}
                  />
                ))
              ) : (
                <EmptyState label="这一栏暂时干净" />
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function ItemsView(props: {
  items: DeadlineItem[];
  syncingId: string | null;
  onConfirm: (item: DeadlineItem) => void;
  onDone: (item: DeadlineItem) => void;
  onDelete: (item: DeadlineItem) => void;
  onSync: (item: DeadlineItem) => void;
}) {
  return (
    <section className="items-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">队列</p>
          <h3>全部事项</h3>
        </div>
        <span className="count-chip">{props.items.length}</span>
      </div>
      <div className="items-list">
        {props.items.length ? (
          props.items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              syncing={props.syncingId === item.id}
              onConfirm={props.onConfirm}
              onDone={props.onDone}
              onDelete={props.onDelete}
              onSync={props.onSync}
            />
          ))
        ) : (
          <EmptyState label="还没有事项，先从风险雷达粘贴一段通知文本。" />
        )}
      </div>
    </section>
  );
}

function SettingsView(props: {
  settings: AppSettings;
  apiKey: string;
  larkStatus: LarkCheckResult | null;
  isSaving: boolean;
  isChecking: boolean;
  isAuthorizing: boolean;
  onSettingsChange: (settings: AppSettings) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onCheckLark: () => void;
  onStartAuth: () => void;
}) {
  const updateModel = (patch: Partial<AppSettings["model"]>) =>
    props.onSettingsChange({ ...props.settings, model: { ...props.settings.model, ...patch } });
  const updateLark = (patch: Partial<AppSettings["lark"]>) =>
    props.onSettingsChange({ ...props.settings, lark: { ...props.settings.lark, ...patch } });

  return (
    <div className="settings-grid">
      <section className="settings-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">模型</p>
            <h3>OpenAI-compatible 配置</h3>
          </div>
          <Cog size={20} />
        </div>
        <FormField label="API Base URL">
          <input className="field" value={props.settings.model.baseUrl} onChange={(event) => updateModel({ baseUrl: event.target.value })} />
        </FormField>
        <FormField label="API Key">
          <input
            className="field"
            type="password"
            value={props.apiKey}
            onChange={(event) => props.onApiKeyChange(event.target.value)}
            placeholder="仅当前会话保存"
          />
        </FormField>
        <div className="two-col">
          <FormField label="Model">
            <input className="field" value={props.settings.model.model} onChange={(event) => updateModel({ model: event.target.value })} />
          </FormField>
          <FormField label="Temperature">
            <input
              className="field"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={props.settings.model.temperature}
              onChange={(event) => updateModel({ temperature: Number(event.target.value) })}
            />
          </FormField>
        </div>
        <div className="two-col">
          <FormField label="请求超时 ms">
            <input
              className="field"
              type="number"
              min="5000"
              step="1000"
              value={props.settings.model.timeoutMs}
              onChange={(event) => updateModel({ timeoutMs: Number(event.target.value) })}
            />
          </FormField>
          <FormField label="语言">
            <input className="field" value={props.settings.model.language} onChange={(event) => updateModel({ language: event.target.value })} />
          </FormField>
        </div>
      </section>

      <section className="settings-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">飞书</p>
            <h3>CLI 与日历</h3>
          </div>
          <CalendarCheck size={20} />
        </div>
        <FormField label="lark-cli 路径">
          <input className="field" value={props.settings.lark.cliPath} onChange={(event) => updateLark({ cliPath: event.target.value })} />
        </FormField>
        <div className="two-col">
          <FormField label="专用日历名称">
            <input
              className="field"
              value={props.settings.lark.calendarName}
              onChange={(event) => updateLark({ calendarName: event.target.value })}
            />
          </FormField>
          <FormField label="默认时区">
            <input className="field" value={props.settings.lark.timezone} onChange={(event) => updateLark({ timezone: event.target.value })} />
          </FormField>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={props.onCheckLark} disabled={props.isChecking} title="检测 lark-cli 和 user 日历权限">
            {props.isChecking ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
            <span>检测飞书 CLI</span>
          </button>
          <button className="secondary-button" onClick={props.onStartAuth} disabled={props.isAuthorizing} title="启动飞书日历授权">
            {props.isAuthorizing ? <Loader2 className="animate-spin" size={18} /> : <ExternalLink size={18} />}
            <span>{props.isAuthorizing ? "等待授权完成" : "启动授权"}</span>
          </button>
        </div>
        {props.larkStatus ? (
          <div className="diagnostic">
            <StatusPill tone={props.larkStatus.cliFound ? "ok" : "warn"} label={props.larkStatus.cliFound ? "CLI 已找到" : "CLI 未找到"} />
            <StatusPill tone={props.larkStatus.doctorOk ? "ok" : "warn"} label={props.larkStatus.doctorOk ? "doctor 通过" : "doctor 待处理"} />
            <StatusPill
              tone={props.larkStatus.userCalendarReady ? "ok" : "warn"}
              label={props.larkStatus.userCalendarReady ? "user 日历可用" : "user 需授权"}
            />
          </div>
        ) : null}
      </section>

      <section className="settings-actions">
        <div>
          <p className="eyebrow">保存</p>
          <h3>写入本地设置</h3>
        </div>
        <button className="primary-button" onClick={props.onSave} disabled={props.isSaving} title="保存非敏感配置到 settings.json">
          {props.isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
          <span>{props.isSaving ? "保存中" : "保存设置"}</span>
        </button>
      </section>
    </div>
  );
}

function ItemCard(props: {
  item: DeadlineItem;
  syncing: boolean;
  compact?: boolean;
  onConfirm: (item: DeadlineItem) => void;
  onDone: (item: DeadlineItem) => void;
  onDelete: (item: DeadlineItem) => void;
  onSync: (item: DeadlineItem) => void;
}) {
  const RiskIcon = riskCopy[props.item.risk.level].icon;
  const isDone = props.item.status === "done";
  const syncDisabled = props.syncing || props.item.pushStatus === "not_pushable" || isDone;

  return (
    <article className={`item-card ${props.compact ? "item-card-compact" : ""}`}>
      <div className="item-card-top">
        <div className="item-title-wrap">
          <span className={`badge ${props.item.timeState === "overdue" ? "badge-danger" : riskCopy[props.item.risk.level].className}`}>
            {props.item.timeState === "overdue" ? <AlertTriangle size={14} /> : <RiskIcon size={14} />}
            {props.item.timeState === "overdue" ? "逾期" : riskCopy[props.item.risk.level].label}
          </span>
          <h4>{props.item.title}</h4>
        </div>
        <span className={`push-dot ${isDone ? "push-done" : `push-${props.item.pushStatus}`}`}>
          {isDone ? "已完成" : pushLabel(props.item.pushStatus)}
        </span>
      </div>

      <p className="item-description">{props.item.description || props.item.source.rawExcerpt || "暂无说明"}</p>

      <div className="item-meta">
        <span>
          <Clock3 size={15} />
          {formatDeadline(props.item)}
        </span>
        <span>{timelineCopy[props.item.risk.timelineBucket] ?? timeStateCopy[props.item.timeState]}</span>
        <span>置信度 {Math.round(props.item.confidence * 100)}%</span>
      </div>

      {!props.compact ? (
        <div className="next-action">
          <strong>下一步</strong>
          <span>{props.item.nextAction}</span>
        </div>
      ) : null}

      <div className="item-actions">
        {props.item.status === "pending" ? (
          <IconButton icon={Check} label="确认" onClick={() => props.onConfirm(props.item)} />
        ) : null}
        {!isDone ? <IconButton icon={ShieldCheck} label="完成" onClick={() => props.onDone(props.item)} /> : null}
        <IconButton
          icon={Send}
          label={props.syncing ? "同步中" : "同步"}
          disabled={syncDisabled}
          loading={props.syncing}
          onClick={() => props.onSync(props.item)}
        />
        <IconButton icon={Trash2} label="删除" danger onClick={() => props.onDelete(props.item)} />
      </div>
    </article>
  );
}

function NavButton(props: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  const Icon = props.icon;
  return (
    <button className={`nav-button ${props.active ? "nav-button-active" : ""}`} onClick={props.onClick} title={props.label}>
      <Icon size={18} />
      <span>{props.label}</span>
    </button>
  );
}

function IconButton(props: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const Icon = props.loading ? Loader2 : props.icon;
  return (
    <button
      className={`icon-button ${props.danger ? "icon-button-danger" : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
    >
      <Icon className={props.loading ? "animate-spin" : ""} size={16} />
    </button>
  );
}

function Metric(props: { icon: LucideIcon; label: string; value: number; tone: string }) {
  const Icon = props.icon;
  return (
    <div className={`metric metric-${props.tone}`}>
      <Icon size={18} />
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function StatusPill(props: { tone: "ok" | "warn" | "idle"; label: string }) {
  return <span className={`status-pill status-${props.tone}`}>{props.label}</span>;
}

function FormField(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function EmptyState(props: { label: string }) {
  return (
    <div className="empty-state">
      <Radar size={20} />
      <span>{props.label}</span>
    </div>
  );
}

function compareItems(a: DeadlineItem, b: DeadlineItem) {
  if (a.status === "done" && b.status !== "done") return 1;
  if (a.status !== "done" && b.status === "done") return -1;

  const rank = (item: DeadlineItem) => {
    if (item.timeState === "overdue") return 0;
    if (item.risk.level === "high") return 1;
    if (item.risk.level === "medium") return 2;
    if (item.risk.level === "watch") return 3;
    if (item.timeState === "no_deadline") return 5;
    return 4;
  };
  const rankDiff = rank(a) - rank(b);
  if (rankDiff !== 0) return rankDiff;
  const aTime = a.deadline.value ? new Date(a.deadline.value).getTime() : Number.MAX_SAFE_INTEGER;
  const bTime = b.deadline.value ? new Date(b.deadline.value).getTime() : Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}

function formatDeadline(item: DeadlineItem) {
  if (!item.deadline.value) {
    return "待补时间";
  }
  const date = new Date(item.deadline.value);
  if (Number.isNaN(date.getTime())) {
    return item.deadline.rawText || "时间待确认";
  }
  if (item.deadline.isAllDay) {
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function pushLabel(status: DeadlineItem["pushStatus"]) {
  if (status === "synced") return "已同步";
  if (status === "failed") return "失败";
  if (status === "not_pushable") return "不可推送";
  return "待推送";
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
