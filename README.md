# Deadline 雷达

Deadline 雷达是一个面向学习、工作和活动通知的信息雷达工具。它的核心目标是把零散文本、飞书文档、网页链接中的安排解析成可执行事项，并通过风险仪表盘和飞书日历推送帮助用户及时处理 deadline。

> 当前状态：Developer Preview / MVP。适合开发者 clone 后本地运行和测试，暂不提供面向普通用户的一键安装包。

## 快速入口

- 使用教程：[docs/USAGE.md](docs/USAGE.md)

## 产品方向

- 信息解析：从粘贴文本、飞书文档/Wiki、普通网页中提取事项。
- 风险仪表盘：展示逾期、高风险、观察项、无明确时间等状态。
- 飞书日历推送：将确认后的事项同步到专用飞书日历，借助飞书 App 触发手机提醒。

## 开发策略

- 技术形态确定为 Electron 桌面应用，而不是纯浏览器 Web App。
- 现场优先开发和验证 Mac 本地版本。
- 代码保持 Windows 兼容，不写死 macOS 路径。
- 不做 `.dmg`、`.exe` 或其他安装包打包。
- 不做系统级通知、开机自启动或自动安装 `lark-cli`。

## 本地依赖

- Node.js
- npm
- lark-cli

Electron、React、Vite、Tailwind CSS 等应用依赖后续通过 npm 安装，不要求用户全局安装 Electron。

`lark-cli` 需要在本机完成安装和授权，后续飞书日历同步会使用当前机器的 `lark-cli --as user` 身份。

## 使用前提

想要正常使用 Deadline 雷达，需要先准备以下环境和账号。应用本地解析和飞书日历同步的前提不同：即使暂时没有完成飞书授权，也可以先使用本地文本解析、风险展示和事项管理。

### 本地使用必须前提

- 一台可运行 Node.js 桌面应用的电脑。
  - 当前优先支持 macOS 本地开发和验证。
  - 代码会保持 Windows 兼容，但第一阶段不打包 `.dmg` 或 `.exe`。
- 已安装 Node.js 和 npm。
  - 用于运行本地 Electron + React 应用。
- 一个可用的 OpenAI-compatible 模型服务。
  - 需要准备 API Base URL、API Key 和 Model 名称。
  - 这些配置会在应用设置页填写。

### 飞书日历同步前提

如果要把确认后的事项同步到飞书日历，还需要满足：

- 当前飞书账号可以正常使用日历。
- 已安装 `lark-cli`。
  - 应用会通过本机 `lark-cli` 调用飞书开放接口。
  - 应用不会自动安装 `lark-cli`。
- 已完成 `lark-cli` 基础配置。
  - 至少需要 `lark-cli doctor` 能找到本地配置。
- `lark-cli` 已获得 calendar 相关用户授权。
- 已登录并授权飞书用户身份。
  - 日历同步优先使用 `lark-cli --as user`。
- 应用能通过 `lark-cli calendar calendars list --as user` 读取日历列表。
- 应用能通过 `lark-cli calendar calendars create --as user` 创建 `Deadline 雷达` 专用日历，或找到已存在的同名日历。
- 应用能通过 `lark-cli calendar events create --as user` 创建日程。

授权入口：

```sh
lark-cli auth login --domain calendar
```

检查入口：

```sh
lark-cli doctor
lark-cli calendar calendars list --as user --params '{"page_size":50}'
```

### 网络前提

- 需要能访问所配置的模型 API 地址。
- 飞书同步需要能访问飞书开放平台。
- 如果后续使用网页链接解析，需要能访问目标网页。

### 不需要的前提

- 不需要安装系统级通知插件。
- 不需要配置开机自启动。
- 不需要安装数据库服务，MVP 使用本地 JSON 文件存储。
- 不需要手写 `.env`，模型和飞书路径配置会放在应用设置页。

## 核心功能规划

1. 文本/链接输入
2. OpenAI-compatible 模型配置与解析
3. 风险仪表盘与截止时间线
4. 推送队列与飞书专用日历同步
5. Mac 优先验证，Windows 代码兼容

## 技术选型

- 桌面壳：Electron
- 前端：React + TypeScript + Vite
- 样式：Tailwind CSS + lucide-react
- 本地后端能力：Electron main process + Node.js `child_process`
- 数据存储：本地 JSON 文件

选择理由：

- Electron 直接调用本机 `lark-cli` 最方便，适合先打通本地闭环。
- React + Vite 开发快，适合快速打磨风险仪表盘和设置页。
- TypeScript 固定数据结构，减少解析、同步、状态流转时的隐性错误。
- JSON 文件足够支撑 MVP，后续如果同步队列复杂再迁移 SQLite。

## 应用内设置

第一版提供设置页，不要求用户手写 `.env`。

### 模型设置

- API Base URL
- API Key
- Model
- Temperature
- 请求超时
- 解析语言偏好，默认中文

### 飞书设置

- `lark-cli` 路径检测，默认使用系统 PATH。
- 身份检测，优先验证 `lark-cli ... --as user`。
- 专用日历名称，默认 `Deadline 雷达`。
- 默认提醒规则：高风险提前 1 天 + 2 小时，中风险提前 1 天，观察项提前 6 小时，低风险提前 2 小时。

### 本地设置文件

MVP 阶段使用应用数据目录下的 JSON 文件：

- `settings.json`：模型非敏感配置、飞书配置、UI 偏好。
- `items.json`：解析后的事项列表。
- `sync-queue.json`：待同步、失败重试和幂等记录。

注意：MVP 默认不把 API Key 持久化到本地 JSON。`settings.json` 保存 API Base URL、Model、Temperature、请求超时等非敏感配置；API Key 默认只保存在运行时内存。用户每次启动后可在设置页填写 API Key；后续如需“记住密钥”，再使用 Electron `safeStorage` 做加密存储。

## 解析字段固定

模型解析输出固定为事项数组，每个事项使用以下字段：

```json
{
  "id": "local generated id",
  "title": "事项标题",
  "description": "补充说明",
  "source": {
    "type": "text | feishu_doc | feishu_wiki | web",
    "title": "来源标题",
    "url": "来源链接，可为空",
    "rawExcerpt": "对应原文片段"
  },
  "deadline": {
    "value": "2026-06-01T18:00:00+08:00 或 null",
    "timezone": "Asia/Shanghai",
    "isAllDay": false,
    "precision": "exact | date | relative | range | unknown",
    "rawText": "原文中的时间表达"
  },
  "risk": {
    "level": "high | medium | watch | low | unknown",
    "reason": "风险判断原因",
    "timelineBucket": "today | tomorrow | within_3_days | within_5_days | later | unscheduled"
  },
  "timeState": "overdue | active | no_deadline",
  "nextAction": "建议下一步行动",
  "confidence": 0.86,
  "status": "pending | confirmed | done | deleted",
  "pushStatus": "pending | synced | failed | not_pushable",
  "reminders": [
    {
      "minutes": 30
    }
  ],
  "calendarSync": {
    "calendarId": null,
    "eventId": null,
    "idempotencyKey": "stable key",
    "lastSyncedAt": null,
    "lastError": null
  },
  "createdAt": "2026-05-31T12:00:00+08:00",
  "updatedAt": "2026-05-31T12:00:00+08:00"
}
```

字段规则：

- `deadline.precision = unknown` 时，`deadline.value = null`、`timeState = no_deadline`、`pushStatus = not_pushable`，需要用户补时间后才能同步。
- 已逾期事项使用 `timeState = overdue` 单独进入逾期区，不放入 `risk.level`。
- `confidence < 0.7` 的事项默认进入观察状态，需要用户确认。
- `idempotencyKey` 基于本地事项 ID 或来源摘要生成，用于防重复创建飞书日程。
- 飞书日程标题使用 `title`，描述包含 `description`、来源、原文片段和风险原因。
- 风险雷达 UI 由 `timeState` 和 `risk.level` 共同分组：逾期来自 `timeState = overdue`，高风险、中风险、观察、低风险来自 `risk.level`。
- `status = done` 或 `deleted` 的事项不进入风险雷达和 `sync-queue.json`；已完成事项仍会保留在全部事项列表中，便于回溯。

## 飞书 CLI 验证结果

截至 2026-05-31，已在本机验证：

- `lark-cli` 路径：`/opt/homebrew/bin/lark-cli`
- 当前版本：`1.0.35`
- 最新提示：`1.0.44` 可更新，但 MVP 不强制更新。
- `lark-cli doctor` 在非沙箱环境通过，飞书开放平台 endpoint 可访问。
- bot 身份已可用。
- user 身份已可用，`lark-cli doctor` 显示 `User identity: ready`。
- `--as user` 已可读取 Calendar 列表。
- 已通过 Electron 应用执行 1 次真实日程同步，成功创建 `Deadline 雷达` 专用日历并创建 1 条日程。
- bot 身份目前缺少 `calendar:calendar:read` scope，不作为 MVP 首选身份。

当前 `--as user` 只读日历列表的验证结果：

```sh
lark-cli calendar calendars list --as user --params '{"page_size":50}'
```

返回成功，说明当前 user 身份已具备 Calendar 读取权限。

真实同步验证结果：

- 专用日历：`Deadline 雷达`
- 同步事项：`将材料发给组长`
- 日程时间：2026-06-01 12:00-12:30，时区 `Asia/Shanghai`
- 飞书端可通过 `calendar events get` 和 `calendar events search_event` 读取到该日程。
- 本地 `items.json` 已写入 `pushStatus = synced`、`eventId` 和 `lastSyncedAt`。

授权入口：

```sh
lark-cli auth login --domain calendar
```

应用内授权流程使用非阻塞授权入口：

```sh
lark-cli auth login --domain calendar --no-wait --json
```

注意：`--no-wait --json` 只会返回 `verification_url` 和 `device_code`。用户在网页完成授权后，还必须继续执行：

```sh
lark-cli auth login --device-code <device_code> --json
```

应用内“启动授权”已经实现这一步，确保授权完成后 token 写入本机 keychain。

已 dry-run 验证的专用日历创建命令：

```sh
lark-cli calendar calendars create --as user \
  --data '{"summary":"Deadline 雷达","description":"Deadline 雷达专用日历","permissions":"private"}' \
  --dry-run
```

已 dry-run 验证的日程创建命令：

```sh
lark-cli calendar events create --as user \
  --params '{"calendar_id":"<Deadline 雷达专用日历ID>","idempotency_key":"deadline-radar-demo"}' \
  --data '{"summary":"Deadline 雷达验证","description":"dry-run only","start_time":{"timestamp":"1780275600","timezone":"Asia/Shanghai"},"end_time":{"timestamp":"1780277400","timezone":"Asia/Shanghai"},"visibility":"private","free_busy_status":"free","reminders":[{"minutes":30}],"source":"deadline-radar"}' \
  --dry-run
```

其中 `<Deadline 雷达专用日历ID>` 来自查找或创建 `Deadline 雷达` 专用日历后的返回值，不使用主日历 `primary` 作为应用主路径。

实现优先使用 `calendar events create`，因为它支持 `idempotency_key`、提醒、时区、公开范围等完整字段。`calendar +create` 可作为人工调试快捷命令，但不作为应用主路径。

## 开发优先级

### P0 核心闭环

- 粘贴文本输入。
- 设置页配置 OpenAI-compatible 模型。
- 调用模型解析并校验固定字段。
- 结构化事项列表。
- 风险状态、截止时间、下一步行动展示。
- 飞书 CLI 连接检测。
- 飞书 user 授权状态检测和授权引导。
- 查找或创建 `Deadline 雷达` 专用飞书日历。
- 用户确认后同步到飞书专用日历。

### P1 产品特色

- 风险雷达：逾期、高风险、中风险、观察、低风险。
- 截止时间线：今天、明天、3 天内、3-5 天、5 天后、无明确时间。
- 推送队列：待推送、已同步、同步失败、不可推送。
- 分级提醒和防重复创建。
- 同步失败重试和错误详情展示。

### P2 增强输入

- 飞书 Doc/Wiki 链接读取。
- 普通网页链接正文提取。
- 公众号链接失败时提示粘贴正文。

### P3 体验打磨

- 编辑、完成、删除事项。
- 搜索和筛选。
- 解析失败重试。
- 仪表盘视觉、空状态、错误状态打磨。

## 运行方式

首次安装依赖：

```sh
npm install
```

启动 Electron 开发模式：

```sh
npm run dev
```

注意：飞书 CLI 检测、授权和同步只能在 Electron 桌面窗口里使用。直接在普通浏览器或 Codex in-app browser 打开 `http://127.0.0.1:5173/` 时，页面会进入浏览器预览模式，只能检查 UI，不能调用本机 `lark-cli`。

构建前端和 Electron 主进程：

```sh
npm run build
```

只预览前端界面：

```sh
npm run preview
```

当前 MVP 已包含：

- Electron + React + TypeScript + Vite 基础骨架。
- 应用内模型设置页，API Key 默认只保存在运行时内存。
- 粘贴文本输入和 OpenAI-compatible 解析调用。
- 飞书 Doc/Docx 链接直读：正文框为空但填写飞书文档链接时，会通过 `lark-cli docs +fetch --as user` 读取文档内容后解析。
- 浏览器预览模式下的 mock 解析结果，方便先验证 UI。
- 本地 JSON 文件读写：`settings.json`、`items.json`、`sync-queue.json`。
- 风险雷达、事项队列、确认、完成、删除、同步按钮。
- 飞书 CLI 检测、授权启动、查找或创建专用日历、同步日程的 Electron 主进程能力。

路演测试文档：

- 标题：`Deadline 雷达路演测试文档`
- 链接：请使用自己飞书空间中的演示文档链接。
- 已验证：`lark-cli docs +fetch --api-version v1 --as user` 可以读取飞书 Doc/Docx 正文。
