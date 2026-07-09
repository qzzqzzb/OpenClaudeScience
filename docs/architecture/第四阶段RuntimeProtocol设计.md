# 第四阶段：Runtime Protocol 标准化设计

## 目标

第四阶段目标是先定义跨 runtime 的稳定协议，再做 mock runtime 验证，最后才评估 OpenCode。

当前阶段不替换 LangGraph / DeepAgents，不改主聊天链路。

目标顺序：

```text
1. 定义 Runtime Protocol
2. 映射当前 LangGraph / DeepAgents 行为
3. 做 MockRuntimeProvider 验证 UI 边界
4. 再评估 OpenCodeRuntimeAdapter
```

## 为什么要先定义协议

第三阶段已经把当前关系讲清楚：

```text
前端 Chat UI
  -> AgentRuntime facade
    -> coordinator
      -> RemoteGraph
        -> runtime
          -> DeepAgents
```

如果现在直接接 OpenCode，会有几个风险：

- OpenCode 的 session/thread 语义不一定等于 LangGraph thread。
- OpenCode 的输出流不一定有稳定结构化事件。
- OpenCode 的工具调用、文件写入、取消、审批语义不一定能直接映射。
- Skills、MCP、subagents 的注入方式和 DeepAgents 不一样。

所以第四阶段先定义平台自己的协议，再把不同 runtime 映射进来。

## 新增 TypeScript 协议

```text
ui/src/lib/agent-runtime-protocol.ts
```

这份协议是客户端可引用的中立类型，不依赖：

- React
- LangGraph SDK
- DeepAgents
- OpenCode

当前包含：

```text
AgentRuntimeProviderKind
AgentRuntimeRunInput
AgentRuntimeRunEvent
AgentRuntimeMessage
AgentRuntimeWorkspaceContext
AgentRuntimeSkillContext
AgentRuntimeMcpToolContext
AgentRuntimeAttachment
AgentRuntimeErrorShape
```

## Run Input

`AgentRuntimeRunInput` 用来描述一次 runtime 控制动作。

核心字段：

```text
intent
threadId
assistantId
resourceId
workspaceId
messages
model
workspace
skills
mcpTools
attachments
runtimeOptions
rawInput
rawOptions
```

设计原则：

- `intent` 使用第三阶段已有的 `AgentRuntimeControlIntent`。
- `messages` 是平台消息语义，不是 LangGraph 原始 message。
- `workspace` 描述工作区边界，不直接暴露 SSH 或本地进程细节。
- `skills` 描述已启用技能，不规定 DeepAgents 的具体加载方式。
- `mcpTools` 描述 MCP 工具上下文，不直接暴露 MCP client。
- `rawInput` / `rawOptions` 是过渡字段，只允许 concrete adapter 使用。

## Run Event

标准事件：

```text
run_started
message_delta
message_completed
tool_call
tool_result
interrupt
state
artifact
error
done
```

这些事件用于下一步验证：

```text
MockRuntimeProvider
  -> 生成 AgentRuntimeRunEvent
  -> UI 不依赖 LangGraph raw event
```

## 当前 LangGraph 映射原则

| 平台协议 | 当前 LangGraph / DeepAgents 来源 |
| --- | --- |
| `threadId` | LangGraph thread id |
| `assistantId` | LangGraph assistant / graph id |
| `messages` | LangChain / LangGraph messages |
| `workspace` | resource/workspace metadata |
| `skills` | `deepagent.config.json` selected skills + threadSkills |
| `mcpTools` | `.mcp.json` / `deepagent.config.json:mcp` 加载结果 |
| `run_started` | LangGraph stream created/run metadata |
| `message_delta` | LangGraph messages stream |
| `interrupt` | LangGraph interrupt |
| `tool_call` / `tool_result` | LangGraph/DeepAgents tool call event |
| `done` | LangGraph run finish |

## 当前不做

本阶段第一步不做：

```text
不切换 useChat 主链路
不把 useStream 替换成自研 stream
不接 OpenCode
不接 mock runtime
不改 agent_graph.py
不改 DeepAgents create_deep_agent()
```

## 下一步

建议下一小步：

```text
新增 MockRuntimeProvider 骨架
  -> 只实现类型和本地事件生成器
  -> 不挂到 UI 主链路
  -> 写清楚如何模拟 message_delta / tool_call / interrupt / error / done
```

完成 mock 后，再判断：

```text
AgentRuntimeProtocol 是否足够表达当前 LangGraph 行为
UI 是否还有隐藏 LangGraph 依赖
OpenCode 是否能映射到同一协议
```

## MockRuntimeProvider 骨架

当前新增：

```text
ui/src/lib/mock-agent-runtime.ts
ui/tests/mock-agent-runtime.test.mts
```

它不是新的真实 Agent，也不是新的后端 runtime。它的作用是用纯前端 TypeScript 生成标准事件，验证协议是否足够表达 Agent 运行过程。

支持的最小场景：

| 场景 | 用途 |
| --- | --- |
| `success` | 验证普通 assistant 文本流 |
| `tool_call` | 验证工具调用和工具结果事件 |
| `interrupt` | 验证人工审批 / 输入中断事件 |
| `error` | 验证错误和失败结束事件 |

当前边界：

```text
MockRuntimeProvider
  -> AgentRuntimeRunEvent[]
  -> 测试验证
```

还没有进入：

```text
Chat UI
useChat.ts
useAgentRuntimeStream()
LangGraphAgentRuntimeAdapter
```

## LangGraph Stream Event 映射

当前新增旁路 mapper：

```text
ui/src/lib/langgraph-runtime-event-mapper.ts
ui/tests/langgraph-runtime-event-mapper.test.mts
```

它负责把现有 `WebRemoteAgent` 捕获到的 `AgentRuntimeStreamEvent` 转成中立协议事件。

当前映射表：

| LangGraph stream | 中立事件 | 说明 |
| --- | --- | --- |
| `messages` / `messages-tuple` assistant 文本 chunk | `message_delta` | 只转换文本增量 |
| assistant `tool_calls` | `tool_call` | 支持 `tool_calls` 和 `additional_kwargs.tool_calls` |
| tool message | `tool_result` | 用 `tool_call_id` 关联工具调用 |
| `__interrupt__` | `interrupt` | 优先于 state 映射 |
| `values` / `updates` | `state` | 仅诊断模式 `includeStateEvents=true` 输出 |
| `error` | `error` | 保留原始 details |

当前明确不映射：

```text
run_started
message_completed
done
```

原因：

- 当前 tapped LangGraph SDK stream event 只有 `event/data/id`，没有稳定 run 生命周期边界。
- `messages-tuple` chunk 不能可靠判断 assistant 消息已经完成。
- 这三类事件后续应该从 run submit/join 生命周期或更稳定的 runtime metadata 中补齐。

## Runtime 生命周期事件

当前新增：

```text
ui/src/lib/agent-runtime-lifecycle.ts
ui/tests/agent-runtime-lifecycle.test.mts
```

职责：

```text
submit / join / cancel 控制层
  -> run_started / done / error / cancelled
```

这层不解析 LangGraph raw message chunk。它只处理 run 生命周期边界：

| helper | 事件 |
| --- | --- |
| `createAgentRuntimeRunStartedEvent()` | `run_started` |
| `createAgentRuntimeDoneEvent()` | `done` |
| `createAgentRuntimeFailedEvents()` | `error` + `done:failed` |
| `createAgentRuntimeCancelledEvents()` | `error:CANCELLED` + `done:cancelled` |

这样后续接入真实 adapter 时，职责会更清楚：

```text
生命周期层：run_started / done / cancel / failed
stream mapper：message_delta / tool_call / tool_result / interrupt / state
provider adapter：LangGraph / Mock / OpenCode 的具体协议适配
```

## Runtime Provider 接口

当前新增：

```text
ui/src/lib/agent-runtime-provider.ts
ui/tests/agent-runtime-provider.test.mts
```

这是第四阶段后续替换 runtime 的最小抽象，不等同于当前主链路里的 `ClientAgentRuntimeAdapter`。

最小形状：

```ts
interface AgentRuntimeProtocolProvider {
  readonly provider: "langgraph" | "mock" | "opencode";
  healthCheck?(): Promise<AgentRuntimeProviderHealth>;
  run(input: AgentRuntimeRunInput, options?: AgentRuntimeProviderRunOptions): AsyncIterable<AgentRuntimeRunEvent>;
  cancelRun?(input: AgentRuntimeCancelRunInput): Promise<void>;
}
```

设计含义：

```text
UI / service 不应该知道底层是 LangGraph、DeepAgents、OpenCode 还是 Mock。
UI / service 只消费 AgentRuntimeRunEvent。
具体 provider 自己负责把底层 raw 协议转换成 AgentRuntimeRunEvent。
```

当前状态：

```text
MockRuntimeProvider
  implements AgentRuntimeProtocolProvider<MockRuntimeRunOptions>
```

后续真实 LangGraph provider 应组合：

```text
AgentRuntime lifecycle helper
  + LangGraph stream event mapper
  + LangGraph SDK run/stream/join/cancel
  -> AgentRuntimeProtocolProvider
```

## LangGraph Protocol Runtime Provider 旁路实现

当前新增：

```text
ui/src/lib/langgraph-protocol-runtime-provider.ts
ui/tests/langgraph-protocol-runtime-provider.test.mts
```

它验证真实 LangGraph provider 的组合方式，但不直接连接真实后端。

组合链路：

```text
LangGraphProtocolRuntimeProvider.run(input)
  -> dependencies.submitRun(input)
  -> run_started
  -> dependencies.streamRunEvents(run)
  -> mapLangGraphStreamEventToRuntimeEvents()
  -> done
```

为什么用依赖注入：

- 当前阶段不希望主链路改动。
- 测试不应该依赖本地 LangGraph backend 是否启动。
- 后续真正接 SDK 时，只需要把 `submitRun` / `streamRunEvents` 换成真实实现。

中断语义：

```text
如果 stream mapper 产出 interrupt：
  provider 不额外产出 done
  等用户审批/继续后再进入下一次 run
```

失败语义：

```text
submitRun 抛错 -> error + done:failed
streamRunEvents 抛错 -> error + done:failed
AbortSignal 取消 -> error:CANCELLED + done:cancelled
```
