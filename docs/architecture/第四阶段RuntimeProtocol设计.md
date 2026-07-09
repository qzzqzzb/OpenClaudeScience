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
