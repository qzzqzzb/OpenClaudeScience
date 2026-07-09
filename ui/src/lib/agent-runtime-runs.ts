export type AgentRuntimeRunIntent =
  | "send_message"
  | "retry_message"
  | "single_step"
  | "rerun_subagent_step"
  | "continue_run"
  | "resolve_thread"
  | "resume_interrupt";

export type AgentRuntimeStopIntent = "stop_run";

export type AgentRuntimeControlIntent =
  | AgentRuntimeRunIntent
  | AgentRuntimeStopIntent;

export interface AgentRuntimeRunDescriptor {
  intent: AgentRuntimeRunIntent;
}

export interface AgentRuntimeStopDescriptor {
  intent: AgentRuntimeStopIntent;
}
