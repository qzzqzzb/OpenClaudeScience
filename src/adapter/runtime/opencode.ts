import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { MessagePart, PermissionDecision, PermissionScope } from "../contract.js";

type SdkResult<T> = Promise<{ data: T; error: undefined } | { data: undefined; error: unknown; response?: Response }>;

export type OpenCodeMessageBundle = {
  info: {
    id?: string;
    role?: string;
    time?: {
      created?: number;
      completed?: number;
    };
    error?: unknown;
  };
  parts: Array<{
    id?: string;
    type?: string;
    text?: string;
  }>;
};

export type OpenCodeRuntimePart = OpenCodeMessageBundle["parts"][number] & Record<string, unknown>;
export type OpenCodeRuntimeEvent = Record<string, unknown>;

export type RuntimeHealth = {
  connected: boolean;
  baseUrl: string;
  version?: string;
  error?: string;
  errorCode?: "FETCH_FAILED" | "HTTP_ERROR" | "INVALID_RUNTIME_HEALTH" | "VERSION_MISMATCH" | "UNHEALTHY";
};

export class RuntimeUnavailableError extends Error {
  constructor(message = "OpenCode runtime is unavailable") {
    super(message);
    this.name = "RuntimeUnavailableError";
  }
}

export class OpenCodeRuntimeError extends Error {
  readonly code = "OPENCODE_RUNTIME_ERROR";
  readonly statusCode = 502;

  constructor(
    message = "OpenCode runtime request failed",
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "OpenCodeRuntimeError";
  }
}

export class UnsupportedMessagePartError extends Error {
  constructor(type: string) {
    super(`Message part type is not supported by the first OpenCode bridge: ${type}`);
    this.name = "UnsupportedMessagePartError";
  }
}

export class OpenCodeRuntime {
  readonly baseUrl: string;
  readonly projectRoot: string;
  readonly sdkVersion: string;
  private readonly client: OpencodeClient;

  constructor(input: { baseUrl: string; projectRoot: string; sdkVersion: string }) {
    this.baseUrl = input.baseUrl;
    this.projectRoot = input.projectRoot;
    this.sdkVersion = input.sdkVersion;
    this.client = createOpencodeClient({
      baseUrl: this.baseUrl,
      responseStyle: "fields",
      throwOnError: false,
    });
  }

  async health(): Promise<RuntimeHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/global/health`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) {
        return { connected: false, baseUrl: this.baseUrl, error: `HTTP ${response.status}`, errorCode: "HTTP_ERROR" };
      }
      const body = (await response.json()) as { healthy?: boolean; version?: string };
      if (body.healthy !== true) {
        return {
          connected: false,
          baseUrl: this.baseUrl,
          version: body.version,
          error: "OpenCode health response was not healthy",
          errorCode: "UNHEALTHY",
        };
      }
      if (!body.version) {
        return {
          connected: false,
          baseUrl: this.baseUrl,
          error: "OpenCode health response did not include a version",
          errorCode: "INVALID_RUNTIME_HEALTH",
        };
      }
      if (body.version !== this.sdkVersion) {
        return {
          connected: false,
          baseUrl: this.baseUrl,
          version: body.version,
          error: `OpenCode version mismatch: expected ${this.sdkVersion}, got ${body.version}`,
          errorCode: "VERSION_MISMATCH",
        };
      }
      return {
        connected: true,
        baseUrl: this.baseUrl,
        version: body.version,
      };
    } catch (error) {
      return {
        connected: false,
        baseUrl: this.baseUrl,
        error: error instanceof Error ? error.message : String(error),
        errorCode: "FETCH_FAILED",
      };
    }
  }

  async requireAvailable(): Promise<void> {
    const health = await this.health();
    if (!health.connected) {
      throw new RuntimeUnavailableError(health.error);
    }
  }

  async listSessions(): Promise<unknown[]> {
    await this.requireAvailable();
    const result = await this.client.session.list({
      query: { directory: this.projectRoot },
    });
    return unwrap(result);
  }

  async createSession(input: { title?: string; parentId?: string }): Promise<{ id: string }> {
    await this.requireAvailable();
    const result = await this.client.session.create({
      body: { title: input.title, parentID: input.parentId },
      query: { directory: this.projectRoot },
    });
    const session = unwrap(result) as { id?: string };
    if (!session.id) throw new Error("OpenCode session response did not include an id");
    return { id: session.id };
  }

  async listMessages(runtimeSessionId: string): Promise<OpenCodeMessageBundle[]> {
    await this.requireAvailable();
    const result = await this.client.session.messages({
      path: { id: runtimeSessionId },
      query: { directory: this.projectRoot },
    });
    return unwrap(result) as OpenCodeMessageBundle[];
  }

  async sendMessage(input: { runtimeSessionId: string; parts: MessagePart[] }): Promise<OpenCodeMessageBundle> {
    await this.requireAvailable();
    const parts = input.parts.map((part) => {
      if (part.type !== "text") throw new UnsupportedMessagePartError(part.type);
      return { type: "text" as const, text: part.text };
    });
    const result = await this.client.session.prompt({
      path: { id: input.runtimeSessionId },
      query: { directory: this.projectRoot },
      body: { parts },
    });
    return unwrap(result) as OpenCodeMessageBundle;
  }

  async stopSession(runtimeSessionId: string): Promise<unknown> {
    await this.requireAvailable();
    const result = await this.client.session.abort({
      path: { id: runtimeSessionId },
      query: { directory: this.projectRoot },
    });
    return unwrap(result);
  }

  async listFiles(input: { path: string }): Promise<unknown[]> {
    await this.requireAvailable();
    const result = await this.client.file.list({
      query: { directory: this.projectRoot, path: input.path },
    });
    return unwrap(result);
  }

  async readFile(input: { path: string }): Promise<unknown> {
    await this.requireAvailable();
    const result = await this.client.file.read({
      query: { directory: this.projectRoot, path: input.path },
    });
    return unwrap(result);
  }

  async searchFiles(input: { query: string }): Promise<string[]> {
    await this.requireAvailable();
    const result = await this.client.find.files({
      query: { directory: this.projectRoot, query: input.query },
    });
    return unwrap(result);
  }

  async listCommands(): Promise<unknown[]> {
    await this.requireAvailable();
    const result = await this.client.command.list();
    return unwrap(result);
  }

  async listAgents(): Promise<unknown[]> {
    await this.requireAvailable();
    const result = await this.client.app.agents();
    return unwrap(result);
  }

  async listMcp(): Promise<unknown> {
    await this.requireAvailable();
    const result = await this.client.mcp.status();
    return unwrap(result);
  }

  async respondToPermission(input: {
    runtimeSessionId: string;
    runtimePermissionId: string;
    decision: PermissionDecision;
    scope?: PermissionScope;
  }): Promise<unknown> {
    await this.requireAvailable();
    const response = input.decision === "deny" ? "reject" : input.scope === "once" ? "once" : "always";
    const result = await this.client.postSessionIdPermissionsPermissionId({
      path: { id: input.runtimeSessionId, permissionID: input.runtimePermissionId },
      query: { directory: this.projectRoot },
      body: { response },
    });
    return unwrap(result);
  }

  async subscribeEvents(input: {
    signal: AbortSignal;
    onEvent(event: OpenCodeRuntimeEvent): void;
    onError(error: unknown): void;
  }): Promise<void> {
    try {
      const result = await this.client.event.subscribe({
        query: { directory: this.projectRoot },
        signal: input.signal,
        sseMaxRetryAttempts: 1,
        onSseError: input.onError,
      });
      for await (const event of result.stream as AsyncGenerator<OpenCodeRuntimeEvent>) {
        if (input.signal.aborted) break;
        input.onEvent(event);
      }
    } catch (error) {
      if (!input.signal.aborted) input.onError(error);
    }
  }
}

function unwrap<T>(result: Awaited<SdkResult<T>>): T {
  if (result.error !== undefined) {
    throw new OpenCodeRuntimeError("OpenCode runtime request failed", result.error);
  }
  if (result.data === undefined) {
    throw new OpenCodeRuntimeError("OpenCode runtime response did not include data");
  }
  return result.data;
}
