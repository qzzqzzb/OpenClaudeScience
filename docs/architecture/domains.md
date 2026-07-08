# InternAgentS 业务域划分

> 范围：本文只定义业务边界和后续接口层方向，不改变现有代码行为。
> 配套文档：`docs/architecture/current-call-map.md` 负责说明“现在怎么调用”，本文负责说明“以后按什么边界理解和改”。

## 1. 这份文档解决什么问题

当前项目已经能工作，但很多职责混在一起：

- 页面组件里直接 `fetch("/api/...")`。
- Next API route 直接读写配置、文件系统、SSH、进程和网络。
- `agent_graph.py` 同时负责模型、DeepAgent、RemoteGraph、Skills、MCP、工具和 middleware。
- 新功能容易继续往大文件里塞，团队很难判断“这个逻辑应该归谁”。

所以第一阶段先不急着拆代码，而是先建立共同语言：

```text
这个功能属于哪个业务域？
这个 API 归哪个业务域？
这个业务域上游是谁？
这个业务域下游依赖什么？
这个业务域不应该负责什么？
后续前端接口层应该怎么命名？
```

## 2. 基本概念

### 业务域是什么

业务域不是技术文件夹，比如 `utils`、`hooks`、`components`、`api`。

业务域是按“功能责任”划分的边界。例如：

```text
workspace 域负责项目文件。
runtime 域负责 LangGraph 服务启停。
skills 域负责技能包管理。
chat 域负责 thread/run/stream/message。
```

技术文件夹回答的是：

```text
这段代码是什么形态？
```

业务域回答的是：

```text
这段代码在业务上归谁管？
```

### 上游是什么

上游就是“谁会调用这个业务域”。

例如 `workspace` 域的上游可能是：

- `WorkspaceExplorer`
- `WorkspaceViewer`
- `ChatInterface`
- `projects/page.tsx`

也就是：

```text
上游 UI / hook / page
  -> workspace 域
```

### 下游是什么

下游就是“这个业务域为了完成任务，会依赖什么系统”。

例如 `workspace` 域的下游可能是：

- 本地文件系统
- SSH 远程 workspace
- Office/PDF 解析
- 操作系统打开文件/文件夹命令

也就是：

```text
workspace 域
  -> local fs / ssh / office-preview / pdf-parse
```

### UI API Client 是什么

本文里说的 `UI API Client` 不是浏览器，也不是后端服务。

它指的是后续准备新增的一层前端 TypeScript API 调用封装，例如：

```text
ui/src/app/services/configClient.ts
ui/src/app/services/workspaceClient.ts
ui/src/app/services/runtimeClient.ts
```

它的作用是把页面里散落的：

```ts
fetch("/api/config")
fetch("/api/workspace/files")
fetch("/api/remote-connections/ensure")
```

收口成有业务名字的函数：

```ts
loadConfig()
listWorkspaceFiles()
ensureRemoteConnectionStream()
```

改造后调用关系应该是：

```text
UI 页面 / 组件 / hook
  -> UI API Client
    -> 现有 Next API route
      -> 本地文件 / SSH / 进程 / LangGraph / Python Agent
```

第一阶段加 UI API Client 时，原则是：

- 不改 API URL。
- 不改 request body。
- 不改 response shape。
- 不改后端 route 行为。
- 只把前端 `fetch` 调用按业务域收口。

## 3. 业务域总览

| 业务域 | 负责什么 | 当前成熟度 | 第一阶段建议 |
| --- | --- | --- | --- |
| `config` | 模型配置、API key、语言、授权模式、`deepagent.config.json` | 边界相对清楚 | 适合较早收口到 `configClient.ts` |
| `runtime` | LangGraph backend/local runtime 健康检查、状态、重启、日志和 pid | 逻辑集中但副作用重 | 先封装前端调用，暂不拆后端 |
| `chat` | thread、run、stream、message、interrupt、goal、thread skills | 最复杂 | 第一阶段尽量不大改 |
| `workspace` | 项目列表、文件树、文件预览、搜索、附件、本地/远程文件访问 | 功能多且耦合重 | 可先迁移低风险文件读取 client |
| `skills` | Skill 列表、导入、启用、active skills、MCP/SCP connections | 边界较清楚 | 可按 API group 收口 |
| `remote` | SSH 远程项目、远程 runtime 安装/同步、资源注册、隧道 | 副作用很重 | 先封装 NDJSON 流式调用 |
| `compute` | SSH 计算主机、远程 job 提交、状态、输出采集 | 独立性较好 | 后续可单独做 `computeClient.ts` |
| `update` | 桌面应用更新检查、应用、回滚 | 支撑域 | 不属于核心 Agent 域，但要明确归属 |

## 4. config 域

### 职责

`config` 域负责系统配置，尤其是模型和用户偏好配置：

- 模型 provider。
- OpenAI-compatible API key。
- OpenAI-compatible Base URL。
- 当前模型名。
- 工具调用授权模式。
- UI 语言。
- onboarding 状态。
- `deepagent.config.json` 中与配置相关的字段。
- `.env` 中模型/API key/Base URL 相关字段。

### 不负责

`config` 域不负责：

- LangGraph 进程启动、停止、重启。
- 聊天 thread/run/stream。
- 工作区文件读取和预览。
- SSH 远程 runtime 安装。
- 远程计算 job。
- Skill 的具体执行。

### 上游

当前主要上游：

- `ui/src/app/config/page.tsx`
- `ui/src/app/page.tsx` 的 onboarding 判断
- `ui/src/app/projects/page.tsx` 的首次配置判断

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/config` | `GET` | 读取配置、模型状态、语言、onboarding 状态 |
| `/api/config` | `PUT` | 保存模型/API key/Base URL/授权模式/语言/workspacePath |

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/config/route.ts` | config 域当前核心 API route |
| `deepagent.config.json` | Agent 主配置，包含模型、authorization、skills、system prompt 等 |
| `.env` | 模型 API key/Base URL 等运行时环境变量 |
| `ui/src/lib/config.ts` | 前端读取 UI runtime config 和静态 UI config |

### 下游

`config` 域当前下游：

- 本地文件系统：读写 `deepagent.config.json`。
- 本地文件系统：读写 `.env`。
- workspace/resource 配置：保存 `workspacePath` 时会调用 workspace 相关逻辑。

### 后续 UI API Client

建议后续新增：

```text
ui/src/app/services/configClient.ts
```

建议函数：

```ts
loadConfig()
saveConfig()
shouldOpenOnboarding()
```

第一阶段只把前端直接 `fetch("/api/config")` 收口，不改变 `/api/config` 协议。

## 5. runtime 域

### 职责

`runtime` 域负责 Agent 运行服务管理。

这里的 runtime 不是 Next.js 里的 `export const runtime = "nodejs"`，而是指 LangGraph/Agent 的实际运行服务。

它负责：

- 检查主 LangGraph backend 是否可访问。
- 检查 local runtime 是否可访问。
- 查询 backend 是否 idle/busy/unavailable。
- 查询 busy/interrupted threads。
- 重启主 backend。
- 重启 local runtime。
- 管理 LangGraph 进程 pid。
- 管理 LangGraph 日志。
- 给桌面 UI 注入运行时配置。

### 不负责

`runtime` 域不负责：

- 模型/API key 表单本身。
- 用户聊天消息。
- 文件树和文件预览。
- Skill 列表和导入。
- SSH 远程项目安装。
- 远程计算 job 提交。

### 上游

当前主要上游：

- `ui/src/app/page.tsx`
- `ui/src/app/config/page.tsx`
- `ui/src/app/skills/components/SkillsMarketplace.tsx`
- `desktop/electron/main.cjs`

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/runtime/backend/ready` | `GET` | 检查指定本地 backend URL 的 `/ok` 是否健康 |
| `/api/runtime/backend/status` | `GET` | 查询 backend 是否 idle/busy/unavailable |
| `/api/runtime/backend/restart` | `POST` | 重启 local runtime 和主 backend |
| `/api/runtime/desktop-config` | `GET` | 输出桌面模式下的前端运行配置 JavaScript |

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/runtime/_lib/backend.ts` | runtime 域当前核心服务管理逻辑 |
| `ui/src/app/api/runtime/backend/ready/route.ts` | readiness API |
| `ui/src/app/api/runtime/backend/status/route.ts` | backend 状态 API |
| `ui/src/app/api/runtime/backend/restart/route.ts` | backend/local runtime 重启 API |
| `ui/src/app/api/runtime/desktop-config/route.ts` | 桌面运行配置注入 API |
| `langgraph.json` | 主 backend/coordinator 的 LangGraph 配置 |
| `langgraph.runtime.json` | local runtime 的 LangGraph 配置 |
| `.internagents/logs/backend.log` | 主 backend 日志 |
| `.internagents/logs/local-runtime.log` | local runtime 日志 |
| `.internagents/pids/backend.pid` | 主 backend pid |
| `.internagents/pids/local-runtime.pid` | local runtime pid |

### 下游

`runtime` 域当前下游：

- `python -m langgraph_cli dev`
- 本地进程表：查找、终止旧进程。
- 本地端口：检查 `/ok`。
- `.env`：读取项目环境变量。
- `internagent.resources*.json`：写回 local runtime URL。
- `.internagents/logs`：输出日志。
- `.internagents/pids`：保存 pid。

### 后续 UI API Client

建议后续新增：

```text
ui/src/app/services/runtimeClient.ts
```

建议函数：

```ts
isLocalDeploymentUrl()
isLocalBackendReady()
getBackendStatus()
restartBackend()
waitForWorkbenchReady()
loadDesktopRuntimeConfig()
```

第一阶段可以先收口 `ready/status/restart`，不要先拆 `backend.ts`。

## 6. chat 域

### 职责

`chat` 域负责用户和 Agent 的对话链路。

它负责：

- thread。
- run。
- stream。
- message。
- interrupt。
- continue/resume。
- stop。
- thread history。
- run lifecycle。
- goal state。
- thread skills state。
- LangGraph SDK client。
- runtime live stream。
- 对话状态恢复。

### 不负责

`chat` 域不负责：

- 工作区文件系统的具体读取。
- workspace 文件预览实现。
- Skill 的导入/启用配置。
- 远程 runtime 安装。
- LangGraph backend 进程启停。
- 模型 API key 保存。

### 上游

当前主要上游：

- `ui/src/app/page.tsx`
- `ui/src/providers/ChatProvider.tsx`
- `ui/src/app/components/ChatInterface.tsx`
- `ui/src/app/components/ThreadList.tsx`

### 当前 API

当前没有单独的 `/api/chat` route。

`chat` 域主要直接使用 LangGraph SDK：

```text
@langchain/langgraph-sdk
@langchain/langgraph-sdk/react
```

当前调用能力包括：

- `useStream()`
- `client.threads.search()`
- `client.threads.get()`
- `client.threads.getState()`
- `client.threads.getHistory()`
- `client.threads.update()`
- `client.threads.updateState()`
- `client.runs.list()`
- `client.runs.joinStream()`

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/hooks/useChat.ts` | chat 域最核心 hook，负责 stream、thread snapshot、goal、runtime stream 等 |
| `ui/src/app/hooks/useThreads.ts` | thread 列表读取和标题推断 |
| `ui/src/app/hooks/useStreamEventLayer.ts` | stream event 收集和 interrupt 提取 |
| `ui/src/lib/remote-agent.ts` | LangGraph SDK `Client` 包装，tap stream/joinStream |
| `ui/src/providers/ClientProvider.tsx` | 创建 `WebRemoteAgent` 和 LangGraph SDK client |
| `ui/src/providers/ChatProvider.tsx` | 给组件树提供 chat context |
| `ui/src/app/components/ChatInterface.tsx` | 聊天 UI、附件、文件引用、Skill 选择入口 |

### 下游

`chat` 域当前下游：

- 主 LangGraph backend。
- resource runtime URL。
- LangGraph SDK。
- `workspace` 域：附件、文件引用、文件搜索。
- `skills` 域：读取可选 Skill 列表。

### 后续 UI API Client

`chat` 域比较特殊。它不一定立刻需要普通 REST client，因为核心链路直接依赖 LangGraph SDK。

后续可以考虑：

```text
ui/src/app/services/chatClient.ts
ui/src/app/services/langGraphClient.ts
ui/src/app/services/threadClient.ts
```

但第一阶段不建议优先迁移 `useChat.ts`，因为它是主链路里风险最高的文件。

建议先做：

- 把 `ChatInterface.tsx` 里的 workspace/skills API 调用分别迁移到 `workspaceClient.ts` 和 `skillsClient.ts`。
- 暂时保留 `useChat.ts` 里的 LangGraph SDK 调用。

## 7. workspace 域

### 职责

`workspace` 域负责项目和文件工作区。

它负责：

- 本地项目列表。
- 当前默认 workspace。
- workspace 切换。
- 文件树。
- 目录列表。
- 文件读取。
- raw 文件流。
- 文件搜索。
- 文件预览类型判断。
- 图片/PDF/Office/科学文件预览入口。
- 附件上传。
- Office/PDF 摘要提取。
- 打开本地文件。
- 打开本地文件夹。
- 远程 SSH workspace 文件读取。
- 远程 SSH workspace 文件写入。

### 不负责

`workspace` 域不负责：

- 聊天 run/stream/message 的生命周期。
- LangGraph backend/local runtime 启停。
- 模型/API key 配置。
- Skill 导入/启用。
- 远程 runtime 安装。
- 远程计算 job 调度。

### 上游

当前主要上游：

- `ui/src/app/projects/page.tsx`
- `ui/src/app/hooks/useWorkspaceFiles.ts`
- `ui/src/app/components/WorkspaceExplorer.tsx`
- `ui/src/app/components/WorkspaceViewer.tsx`
- `ui/src/app/components/WorkspacePanel.tsx`
- `ui/src/app/components/ChatInterface.tsx`
- `ui/src/app/page.tsx`

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/workspaces` | `GET` | 读取本地 workspace 列表 |
| `/api/workspaces` | `POST` | 打开本地目录选择器并添加 workspace |
| `/api/workspaces` | `PUT` | 设置默认 workspace |
| `/api/workspaces` | `PATCH` | 更新 workspace 名称或路径 |
| `/api/workspaces` | `DELETE` | 删除 workspace 记录 |
| `/api/workspace/files` | `GET` | 列出目录内容 |
| `/api/workspace/file` | `GET` | 获取文件预览数据 |
| `/api/workspace/file/raw` | `GET` | 获取 raw 文件流或二进制内容 |
| `/api/workspace/search` | `GET` | 搜索 workspace 文件 |
| `/api/workspace/attachments` | `POST` | 上传附件或把 workspace 文件转成聊天附件 |
| `/api/workspace/open-folder` | `POST` | 用系统文件管理器打开本地 workspace |
| `/api/workspace/open-file` | `POST` | 用系统默认程序打开本地文件 |

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/workspaces/route.ts` | workspace 列表和默认 workspace 管理 |
| `ui/src/app/api/workspace/_lib/workspace.ts` | workspace 域当前最重的后端逻辑模块 |
| `ui/src/app/api/workspace/_lib/office-preview.ts` | Office 文件可读预览 |
| `ui/src/app/api/workspace/_lib/open-folder.ts` | 打开本地文件夹 |
| `ui/src/app/api/workspace/files/route.ts` | 文件树目录列表 |
| `ui/src/app/api/workspace/file/route.ts` | 文件预览 |
| `ui/src/app/api/workspace/file/raw/route.ts` | raw 文件流 |
| `ui/src/app/api/workspace/search/route.ts` | 文件搜索 |
| `ui/src/app/api/workspace/attachments/route.ts` | 附件上传和提取 |
| `ui/src/app/hooks/useWorkspaceFiles.ts` | 文件树状态 hook |
| `ui/src/app/components/WorkspaceExplorer.tsx` | 文件树 UI |
| `ui/src/app/components/WorkspaceViewer.tsx` | 文件预览 UI |
| `internagent.resources.json` | resource/workspace 默认配置 |
| `internagent.resources.local.json` | 本地覆盖资源配置 |

### 下游

`workspace` 域当前下游：

- 本地文件系统。
- SSH 远程 workspace。
- Python/Node 子进程。
- Office 解析。
- PDF 文本提取。
- 操作系统打开文件/目录命令。
- resource 配置文件。

### 后续 UI API Client

建议拆成两个 client，因为 `workspaces` 和 `workspace files` 是两个不同层次：

```text
ui/src/app/services/workspacesClient.ts
ui/src/app/services/workspaceClient.ts
```

建议函数：

```ts
// workspacesClient.ts
listWorkspaces()
pickWorkspace()
setDefaultWorkspace()
updateWorkspace()
removeWorkspace()

// workspaceClient.ts
listWorkspaceFiles()
getWorkspaceFile()
workspaceRawFileUrl()
searchWorkspace()
uploadWorkspaceAttachment()
attachWorkspaceFile()
openWorkspaceFolder()
openWorkspaceFile()
```

第一阶段优先迁移低风险调用：

- `useWorkspaceFiles.ts` -> `listWorkspaceFiles()`
- `WorkspaceViewer.tsx` -> `getWorkspaceFile()` / `openWorkspaceFile()`
- `WorkspaceExplorer.tsx` -> `openWorkspaceFolder()`

## 8. skills 域

### 职责

`skills` 域负责技能包管理。

它负责：

- Skill 列表。
- Skill 搜索/展示。
- Skill 导入。
- 本地 Skill 选择。
- 云端 Skill 下载。
- Skill 启用/禁用。
- active skills 同步。
- `.internagents/active-skills`。
- `.internagents/imported-skills`。
- MCP 配置。
- SCP API key 配置。
- Skill frontmatter 解析。

### 不负责

`skills` 域不负责：

- Skill 在一次聊天中具体怎么被模型使用。
- LangGraph backend 进程启停。
- workspace 文件预览。
- SSH 远程 runtime 安装。
- 远程计算 job。

说明：

```text
Skill 是能力包，不等于独立 Agent。
```

例如 `aircraft-geometry-audit` Skill 可以给 Agent 增加航空几何审查能力，但它不会自动变成一个独立运行的航空 Agent。

### 上游

当前主要上游：

- `ui/src/app/skills/page.tsx`
- `ui/src/app/skills/components/SkillsMarketplace.tsx`
- `ui/src/app/components/ChatInterface.tsx`
- `internagents/thread_skill_middleware.py`

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/skills` | `GET` | 读取 Skill 配置和可用 Skill 列表 |
| `/api/skills` | `PUT` | 保存启用状态和选中的 Skill |
| `/api/skills/import` | `POST` | 从本地或云端导入 Skill |
| `/api/skills/local-picker` | `POST` | 打开本地目录选择器选择 Skill |
| `/api/skills/connections` | `GET` | 读取 MCP/SCP connection 配置 |
| `/api/skills/connections` | `PUT` | 保存 MCP/SCP connection 配置 |

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/skills/_lib/skills.ts` | Skill 发现、导入、启用和 active skills 同步 |
| `ui/src/app/api/skills/_lib/skill-frontmatter.ts` | Skill frontmatter 解析 |
| `ui/src/app/api/skills/route.ts` | Skill 列表和启用配置 API |
| `ui/src/app/api/skills/import/route.ts` | Skill 导入 API |
| `ui/src/app/api/skills/local-picker/route.ts` | 本地目录选择 API |
| `ui/src/app/api/skills/connections/route.ts` | MCP/SCP connection 配置 API |
| `ui/src/app/skills/components/SkillsMarketplace.tsx` | Skills UI |
| `internagents/thread_skill_middleware.py` | 线程级 Skill 注入 |
| `deepagent.config.json` | 持久 Skill 配置 |
| `.mcp.json` | MCP server 配置 |
| `.internagents/active-skills` | 当前启用 Skill 的 symlink/copy |
| `.internagents/imported-skills` | 导入的 Skill |

### 下游

`skills` 域当前下游：

- 本地文件系统。
- GitHub archive/raw 下载。
- `git clone/fetch/checkout`。
- 本地目录选择器。
- `.env`。
- `.mcp.json`。
- `deepagent.config.json`。

### 后续 UI API Client

建议后续新增：

```text
ui/src/app/services/skillsClient.ts
```

建议函数：

```ts
listSkills()
updateSkills()
importSkills()
pickLocalSkillFolder()
loadSkillConnections()
saveSkillConnections()
```

第一阶段可以先迁移 `SkillsMarketplace.tsx` 里的 `/api/skills*` fetch，但不要同时重写 Skills UI。

## 9. remote 域

### 职责

`remote` 域负责远程项目和远程 Agent runtime。

它负责：

- 读取 `~/.ssh/config`。
- 测试 SSH 连接。
- 新增远程 resource。
- 安装远程 backend CLI。
- 同步远程 backend CLI 版本。
- 启动远程 LangGraph runtime。
- 建立本地端口到远程 runtime 的 SSH tunnel。
- 写回 `remote_url`。
- 写回 `remote_runtime_port`。
- 管理 `remote1` 到 `remote8` 资源槽位。
- 列出 UI 可用 resources。

### 不负责

`remote` 域不负责：

- 远程计算 job 提交。
- 文件树 UI 展示。
- 聊天 thread/run/stream。
- 模型 API key 表单。
- Skill 导入/启用。

`remote` 和 `compute` 的区别：

```text
remote = 让远程机器上跑一个 Agent runtime。
compute = 在远程机器上提交一次计算 job。
```

### 上游

当前主要上游：

- `ui/src/app/page.tsx`
- `ui/src/app/components/RemoteConnectionDialog.tsx`
- `ui/src/app/config/components/RemoteProjectsSettingsCard.tsx`
- `ui/src/app/config/components/ComputeSettingsCard.tsx` 的 SSH host 下拉

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/resources` | `GET` | 读取 UI 可用 resource 列表 |
| `/api/remote-connections/ssh-hosts` | `GET` | 读取 `~/.ssh/config` 中的 Host |
| `/api/remote-connections/test` | `POST` | 测试 SSH 连接 |
| `/api/remote-connections/setup` | `POST` | 新增远程 runtime resource，NDJSON 流式返回日志 |
| `/api/remote-connections/ensure` | `POST` | 确保远程 runtime 版本可用，NDJSON 流式返回日志 |
| `/api/remote-connections/push-backend-cli` | `POST` | 推送本地 backend CLI 到远程机器，NDJSON 流式返回日志 |

说明：`/api/resources` 是跨域资源注册表接口，`chat`、`workspace`、`remote` 都会用到。当前建议暂归 `remote/resource registry` 管理，后续如果资源模型变复杂，可以单独拆 `resources` 域。

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/resources/route.ts` | UI resources 列表 |
| `ui/src/app/api/remote-connections/_lib/remote-connections.ts` | remote 域当前最重的后端逻辑模块 |
| `ui/src/app/api/remote-connections/ssh-hosts/route.ts` | SSH Host 列表 API |
| `ui/src/app/api/remote-connections/test/route.ts` | SSH 测试 API |
| `ui/src/app/api/remote-connections/setup/route.ts` | 远程 runtime setup API |
| `ui/src/app/api/remote-connections/ensure/route.ts` | 远程 runtime ensure API |
| `ui/src/app/api/remote-connections/push-backend-cli/route.ts` | backend CLI 推送 API |
| `internagent.resources.json` | resource 配置 |
| `internagent.resources.local.json` | 本地覆盖 resource 配置 |
| `.env` | 可能保存 `INTERNAGENT_RESOURCES_FILE` |

### 下游

`remote` 域当前下游：

- `~/.ssh/config`。
- `ssh` 命令。
- 远程 Linux/macOS shell。
- GitHub release/archive/raw。
- 本地端口。
- SSH tunnel。
- resource 配置文件。
- `.env`。

### 后续 UI API Client

建议后续新增：

```text
ui/src/app/services/resourcesClient.ts
ui/src/app/services/remoteClient.ts
```

建议函数：

```ts
// resourcesClient.ts
listResources()

// remoteClient.ts
listRemoteSshHosts()
testRemoteConnection()
setupRemoteConnectionStream()
ensureRemoteConnectionStream()
pushBackendCliStream()
```

第一阶段优先迁移 NDJSON 流式调用的重复解析逻辑：

- `/api/remote-connections/ensure`
- `/api/remote-connections/setup`
- `/api/remote-connections/push-backend-cli`

## 10. compute 域

### 职责

`compute` 域负责远程计算任务。

它负责：

- 注册 SSH compute host。
- 校验 compute host 是否 Linux。
- 提交远程 shell job。
- 记录 job 状态。
- 查询 job 状态。
- 收集 stdout/stderr。
- 收集输出文件。
- 管理 compute API token。

### 不负责

`compute` 域不负责：

- 远程 Agent runtime 安装。
- remote resource 注册。
- workspace 文件预览。
- 聊天 thread/run/stream。
- Skill 导入/启用。

### 上游

当前主要上游：

- `ui/src/app/config/components/ComputeSettingsCard.tsx`
- `internagents/remote_compute_tools.py`

说明：`remote_compute_tools.py` 是 Agent 侧工具。Agent 调用远程计算时，会通过 HTTP 调回 UI 的 `/api/compute/*` 接口。

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/compute/ssh-hosts` | `GET` | 读取已注册 compute host |
| `/api/compute/ssh-hosts` | `POST` | 注册或更新 compute host |
| `/api/compute/remote-jobs` | `GET` | 列出远程计算 job |
| `/api/compute/remote-jobs` | `POST` | 提交远程计算 job |
| `/api/compute/remote-jobs/[jobId]` | `GET` | 查询单个 job 状态和输出 |

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/compute/_lib/ssh-remote-jobs.ts` | compute 域核心逻辑 |
| `ui/src/app/api/compute/_lib/compute-auth.ts` | compute API token 和本地 origin 校验 |
| `ui/src/app/api/compute/ssh-hosts/route.ts` | compute host API |
| `ui/src/app/api/compute/remote-jobs/route.ts` | job 列表和提交 API |
| `ui/src/app/api/compute/remote-jobs/[jobId]/route.ts` | job 查询 API |
| `ui/src/app/config/components/ComputeSettingsCard.tsx` | compute host 设置 UI |
| `internagents/remote_compute_tools.py` | Agent 侧远程计算工具 |
| `.internagents/compute/ssh-hosts.json` | compute host 状态 |
| `.internagents/compute/remote-jobs.json` | job 状态 |
| `.internagents/compute/api-token` | compute API token |

### 下游

`compute` 域当前下游：

- `~/.ssh/config` 中的 Host alias。
- SSH Linux 主机。
- 远程 bash/python。
- `.internagents/compute/*` 状态文件。

### 后续 UI API Client

建议后续新增：

```text
ui/src/app/services/computeClient.ts
```

建议函数：

```ts
listComputeHosts()
upsertComputeHost()
listRemoteJobs()
submitRemoteJob()
getRemoteJobSnapshot()
```

第一阶段可以先不动 compute，因为它相对独立，等 config/workspace/remote 收口后再处理。

## 11. update 支撑域

### 职责

`update` 是桌面应用生命周期支撑域，不属于 7 个核心 Agent 业务域，但代码中存在，需要明确归属。

它负责：

- 检查当前版本。
- 检查远程 release。
- 下载更新包。
- 应用更新。
- 回滚更新。
- 更新状态展示。

### 不负责

`update` 域不负责：

- Agent 对话。
- 模型配置。
- workspace 文件。
- Skill 管理。
- runtime 编排逻辑。

### 上游

当前主要上游：

- `ui/src/app/about/page.tsx`

### 当前 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/update/status` | `GET` | 读取当前更新状态 |
| `/api/update/check` | `POST` | 检查新版本 |
| `/api/update/apply` | `POST` | 应用更新 |
| `/api/update/rollback` | `POST` | 回滚更新 |

### 当前代码/文件

| 文件 | 说明 |
| --- | --- |
| `ui/src/app/api/update/_lib/update.ts` | update 域核心逻辑 |
| `ui/src/app/api/update/status/route.ts` | 更新状态 API |
| `ui/src/app/api/update/check/route.ts` | 检查更新 API |
| `ui/src/app/api/update/apply/route.ts` | 应用更新 API |
| `ui/src/app/api/update/rollback/route.ts` | 回滚更新 API |
| `ui/src/app/about/page.tsx` | 更新 UI |

### 下游

`update` 域当前下游：

- GitHub release API。
- release asset 下载。
- 本地应用包/备份目录。
- 桌面应用运行环境。

### 后续 UI API Client

建议后续新增：

```text
ui/src/app/services/updateClient.ts
```

建议函数：

```ts
getUpdateStatus()
checkForUpdate()
applyUpdate()
rollbackUpdate()
```

## 12. 跨域对象：resource

`resource` 是当前系统里一个跨域概念，暂时不建议马上单独拆域，但要在团队里说清楚。

resource 表示一个可被 UI 选择的 Agent 执行资源，例如：

```text
local
remote1
remote2
```

resource 同时影响：

- `chat`：当前对话要用哪个 `assistantId` 和 `runtimeUrl`。
- `workspace`：当前文件系统根目录在哪里。
- `remote`：远程 runtime 的 URL、端口、SSH 配置。
- `runtime`：local runtime URL 写回 local resource。

当前主要配置文件：

```text
internagent.resources.json
internagent.resources.local.json
```

当前相关 API：

```text
/api/resources
/api/workspaces
/api/remote-connections/*
/api/runtime/backend/restart
```

第一阶段建议：

- 文档里承认 resource 是跨域对象。
- 前端可先有 `resourcesClient.ts`。
- 暂不急着拆 `resources` 独立后端 service。

## 13. API route -> domain owner 映射

| API route | 归属域 | 备注 |
| --- | --- | --- |
| `/api/config` | `config` | 配置读写 |
| `/api/runtime/backend/ready` | `runtime` | readiness |
| `/api/runtime/backend/status` | `runtime` | backend 状态 |
| `/api/runtime/backend/restart` | `runtime` | 重启 local runtime 和 main backend |
| `/api/runtime/desktop-config` | `runtime` | 桌面运行配置注入 |
| `/api/workspaces` | `workspace` | workspace 列表和默认 workspace |
| `/api/workspace/files` | `workspace` | 文件树 |
| `/api/workspace/file` | `workspace` | 文件预览 |
| `/api/workspace/file/raw` | `workspace` | raw 文件 |
| `/api/workspace/search` | `workspace` | 文件搜索 |
| `/api/workspace/attachments` | `workspace` | 附件上传/提取 |
| `/api/workspace/open-folder` | `workspace` | 打开本地目录 |
| `/api/workspace/open-file` | `workspace` | 打开本地文件 |
| `/api/skills` | `skills` | Skill 列表和启用 |
| `/api/skills/import` | `skills` | Skill 导入 |
| `/api/skills/local-picker` | `skills` | 本地 Skill 目录选择 |
| `/api/skills/connections` | `skills` | MCP/SCP connections |
| `/api/resources` | `remote/resource registry` | 跨域 resource 列表，暂归 remote/resource registry |
| `/api/remote-connections/ssh-hosts` | `remote` | SSH Host 列表 |
| `/api/remote-connections/test` | `remote` | SSH 测试 |
| `/api/remote-connections/setup` | `remote` | 新增远程 runtime |
| `/api/remote-connections/ensure` | `remote` | 确保远程 runtime 可用 |
| `/api/remote-connections/push-backend-cli` | `remote` | 推送 backend CLI |
| `/api/compute/ssh-hosts` | `compute` | compute host |
| `/api/compute/remote-jobs` | `compute` | job 列表/提交 |
| `/api/compute/remote-jobs/[jobId]` | `compute` | job 查询 |
| `/api/update/status` | `update` | 更新状态 |
| `/api/update/check` | `update` | 检查更新 |
| `/api/update/apply` | `update` | 应用更新 |
| `/api/update/rollback` | `update` | 回滚更新 |

## 14. domain -> 后续 UI API Client 映射

| 业务域 | 建议 client 文件 | 第一阶段优先级 |
| --- | --- | --- |
| `config` | `ui/src/app/services/configClient.ts` | 高 |
| `runtime` | `ui/src/app/services/runtimeClient.ts` | 高 |
| `workspace` | `ui/src/app/services/workspacesClient.ts`、`workspaceClient.ts` | 高 |
| `remote` | `ui/src/app/services/resourcesClient.ts`、`remoteClient.ts` | 高 |
| `skills` | `ui/src/app/services/skillsClient.ts` | 中 |
| `compute` | `ui/src/app/services/computeClient.ts` | 中低 |
| `update` | `ui/src/app/services/updateClient.ts` | 低 |
| `chat` | `chatClient.ts` / `langGraphClient.ts` / `threadClient.ts` | 暂缓 |

建议第一批只做：

```text
configClient.ts
runtimeClient.ts
resourcesClient.ts
workspacesClient.ts
workspaceClient.ts
remoteClient.ts
```

不要第一批就改 `useChat.ts`。

## 15. 第一阶段落地顺序

建议顺序：

1. 保留所有现有 API route，不改协议。
2. 完成 `current-call-map.md`，让团队看懂现状。
3. 完成本文 `domains.md`，让团队统一业务边界。
4. 新增 `ui/src/app/services/apiClient.ts`，封装通用 JSON/NDJSON 读取。
5. 逐个新增 domain client。
6. 每次只迁移一个页面或一个 API group。
7. 每次迁移后运行 lint/关键功能手测。

第一批可迁移：

```text
/api/config
/api/resources
/api/workspaces
/api/workspace/files
/api/workspace/file
/api/workspace/open-folder
/api/workspace/open-file
/api/remote-connections/ensure
```

暂缓迁移：

```text
useChat.ts 中的 LangGraph SDK 主链路
internagents/agent_graph.py
ui/src/app/api/workspace/_lib/workspace.ts
ui/src/app/api/remote-connections/_lib/remote-connections.ts
```

## 16. 判断代码应该放哪个域的简单规则

以后新增功能时，可以先问这几个问题：

1. 它是不是在改模型/API key/语言/授权？
   - 是：`config`
2. 它是不是在启动、停止、检查 LangGraph 服务？
   - 是：`runtime`
3. 它是不是 thread/run/stream/message/interrupt？
   - 是：`chat`
4. 它是不是项目文件、文件树、预览、搜索、附件？
   - 是：`workspace`
5. 它是不是 Skill 列表、导入、启用、MCP/SCP 连接？
   - 是：`skills`
6. 它是不是 SSH 远程 Agent runtime？
   - 是：`remote`
7. 它是不是提交远程计算 job？
   - 是：`compute`
8. 它是不是桌面应用更新？
   - 是：`update`

如果一个功能跨多个域，要明确主归属和调用关系，不要直接互相塞逻辑。

例如航空 CAE 文件解析：

```text
文件读取入口：workspace
专业解析能力：未来 aircraft/cae domain 或 skill/tool
报告输出：chat/report workflow
远程求解：compute
远程 runtime：remote
```

这能避免把所有航空功能都塞进 `workspace/_lib/workspace.ts`。

## 17. 后续重构边界

第一阶段只做：

```text
UI 页面 / hook
  -> UI API Client
    -> 现有 API route
```

第二阶段再考虑：

```text
API route
  -> server domain service
    -> adapter
      -> fs / ssh / process / GitHub / LangGraph
```

第三阶段再考虑 Python 侧：

```text
agent_graph.py
  -> model config
  -> backend factory
  -> tool registry
  -> skill registry
  -> remote graph router
  -> middleware assembly
```

也就是说，不要一次把 UI、Next API、Python Agent 全拆了。先建立边界，再一点一点收口。这个项目已经够热闹了，别让重构也开始开派对。
