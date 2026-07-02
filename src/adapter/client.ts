import type {
  AdapterCommandName,
  AdapterEventName,
  AdapterSnapshots,
  Annotation,
  ArtifactId,
  ArtifactMetadata,
  ArtifactVersion,
  Connector,
  FileNode,
  Message,
  MessagePart,
  PermissionId,
  PermissionRequest,
  PermissionScope,
  PlanState,
  ProjectId,
  ProjectSnapshot,
  ProvenanceRecord,
  RemoteJob,
  ReviewerFinding,
  SessionGroup,
  SessionId,
  SessionSnapshot,
  Settings,
  Skill,
  Specialist,
  ToolEvent,
  Track,
  VersionId,
  WsAckEnvelope,
  WsCommandEnvelope,
  WsEnvelope,
  WsErrorEnvelope,
  WsEventEnvelope,
} from "./types";
import { MockAdapterTransport } from "./mockTransport";

export interface AdapterTransport {
  connect(projectId: ProjectId, lastEventId?: string): void;
  close(): void;
  onEnvelope(handler: (envelope: WsEnvelope) => void): () => void;
  sendCommand(command: AdapterCommandName, payload: unknown): Promise<WsAckEnvelope | WsErrorEnvelope>;
  getHealth(): Promise<{ ok: boolean; mode: "mock" | "real" }>;
  getProjects(): Promise<ProjectSnapshot[]>;
  getCurrentProject(): Promise<ProjectSnapshot>;
  selectProject(projectId: ProjectId): Promise<ProjectSnapshot>;
  getSessions(projectId: ProjectId, group: SessionGroup): Promise<SessionSnapshot[]>;
  createSession(projectId: ProjectId): Promise<SessionSnapshot>;
  getSession(sessionId: SessionId): Promise<SessionSnapshot>;
  patchSession(sessionId: SessionId, patch: Partial<SessionSnapshot>): Promise<SessionSnapshot>;
  deleteSession(sessionId: SessionId): Promise<{ ok: true }>;
  getMessages(sessionId: SessionId): Promise<AdapterSnapshots["messages"][SessionId]>;
  getTracks(sessionId: SessionId): Promise<AdapterSnapshots["tracks"][SessionId]>;
  stopSession(sessionId: SessionId): Promise<{ ok: true }>;
  getFilesTree(projectId: ProjectId, path?: string): Promise<FileNode[]>;
  getFileContent(projectId: ProjectId, path: string): Promise<{ path: string; content: string }>;
  searchFiles(projectId: ProjectId, q: string): Promise<FileNode[]>;
  upload(fileName: string): Promise<{ uploadId: string; name: string }>;
  getArtifacts(projectId: ProjectId, sessionId: SessionId): Promise<ArtifactMetadata[]>;
  getArtifact(artifactId: ArtifactId): Promise<ArtifactMetadata>;
  patchArtifact(artifactId: ArtifactId, patch: Partial<ArtifactMetadata>): Promise<ArtifactMetadata>;
  deleteArtifact(artifactId: ArtifactId): Promise<{ ok: true }>;
  getArtifactVersions(artifactId: ArtifactId): Promise<ArtifactVersion[]>;
  getProvenance(artifactId: ArtifactId, versionId: VersionId): Promise<ProvenanceRecord>;
  getDownloadUrl(artifactId: ArtifactId, versionId?: VersionId): Promise<{ url: string }>;
  getPermissions(): Promise<AdapterSnapshots["permissions"]>;
  revokePermission(permissionId: PermissionId): Promise<{ ok: true }>;
  getSettings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;
  getConnectors(): Promise<Connector[]>;
  getSkills(): Promise<Skill[]>;
  getSpecialists(): Promise<Specialist[]>;
}

export class AdapterClient {
  constructor(private transport: AdapterTransport) {}

  resources = {
    health: () => this.transport.getHealth(),
    projects: () => this.transport.getProjects(),
    currentProject: () => this.transport.getCurrentProject(),
    selectProject: (projectId: ProjectId) => this.transport.selectProject(projectId),
    sessions: (projectId: ProjectId, group: SessionGroup) => this.transport.getSessions(projectId, group),
    createSession: (projectId: ProjectId) => this.transport.createSession(projectId),
    session: (sessionId: SessionId) => this.transport.getSession(sessionId),
    patchSession: (sessionId: SessionId, patch: Partial<SessionSnapshot>) => this.transport.patchSession(sessionId, patch),
    deleteSession: (sessionId: SessionId) => this.transport.deleteSession(sessionId),
    messages: (sessionId: SessionId) => this.transport.getMessages(sessionId),
    tracks: (sessionId: SessionId) => this.transport.getTracks(sessionId),
    stopSession: (sessionId: SessionId) => this.transport.stopSession(sessionId),
    filesTree: (projectId: ProjectId, path?: string) => this.transport.getFilesTree(projectId, path),
    fileContent: (projectId: ProjectId, path: string) => this.transport.getFileContent(projectId, path),
    searchFiles: (projectId: ProjectId, q: string) => this.transport.searchFiles(projectId, q),
    upload: (fileName: string) => this.transport.upload(fileName),
    artifacts: (projectId: ProjectId, sessionId: SessionId) => this.transport.getArtifacts(projectId, sessionId),
    artifact: (artifactId: ArtifactId) => this.transport.getArtifact(artifactId),
    patchArtifact: (artifactId: ArtifactId, patch: Partial<ArtifactMetadata>) => this.transport.patchArtifact(artifactId, patch),
    deleteArtifact: (artifactId: ArtifactId) => this.transport.deleteArtifact(artifactId),
    artifactVersions: (artifactId: ArtifactId) => this.transport.getArtifactVersions(artifactId),
    provenance: (artifactId: ArtifactId, versionId: VersionId) => this.transport.getProvenance(artifactId, versionId),
    downloadUrl: (artifactId: ArtifactId, versionId?: VersionId) => this.transport.getDownloadUrl(artifactId, versionId),
    permissions: () => this.transport.getPermissions(),
    revokePermission: (permissionId: PermissionId) => this.transport.revokePermission(permissionId),
    settings: () => this.transport.getSettings(),
    patchSettings: (patch: Partial<Settings>) => this.transport.patchSettings(patch),
    connectors: () => this.transport.getConnectors(),
    skills: () => this.transport.getSkills(),
    specialists: () => this.transport.getSpecialists(),
  };

  realtime = {
    connect: (projectId: ProjectId, lastEventId?: string) => this.transport.connect(projectId, lastEventId),
    close: () => this.transport.close(),
    onEnvelope: (handler: (envelope: WsEnvelope) => void) => this.transport.onEnvelope(handler),
  };

  commands = {
    projectSelect: (projectId: ProjectId) => this.command("project.select", { projectId }),
    sessionCreate: (projectId: ProjectId) => this.command("session.create", { projectId }),
    sessionOpen: (sessionId: SessionId) => this.command("session.open", { sessionId }),
    sessionSendMessage: (payload: unknown) => this.command("session.sendMessage", payload),
    sessionStop: (sessionId: SessionId) => this.command("session.stop", { sessionId }),
    permissionRespond: (permissionId: PermissionId, decision: "approve" | "deny", scope?: PermissionScope, reason?: string) =>
      this.command("permission.respond", { permissionId, decision, scope, reason }),
    planApprove: (planId: string, _sessionId: SessionId) => this.command("plan.approve", { planId }),
    planRequestRevision: (planId: string, sessionId: SessionId, note: string) =>
      this.command("plan.requestRevision", { planId, sessionId, message: note }),
    artifactOpen: (artifactId: ArtifactId, versionId?: VersionId) => this.command("artifact.open", { artifactId, versionId }),
    artifactStar: (artifactId: ArtifactId, starred: boolean) => this.command("artifact.star", { artifactId, starred }),
    artifactRename: (artifactId: ArtifactId, name: string) => this.command("artifact.rename", { artifactId, name }),
    artifactDelete: (artifactId: ArtifactId) => this.command("artifact.delete", { artifactId }),
    artifactDownloadUrl: (artifactId: ArtifactId, versionId?: VersionId) => this.command("artifact.downloadUrl", { artifactId, versionId }),
    annotationStage: (payload: unknown) => this.command("annotation.stage", payload),
    annotationDiscard: (annotationId: string) => this.command("annotation.discard", { annotationIds: [annotationId] }),
    annotationCommitWithMessage: (payload: any) =>
      this.command("annotation.commitWithMessage", { sessionId: payload.sessionId, annotationIds: payload.annotationIds, parts: [{ type: "text", text: payload.text ?? "" }] }),
    reviewerRun: (sessionId: SessionId, artifactId?: ArtifactId, versionId?: VersionId) =>
      this.command("reviewer.run", { sessionId, artifactId, versionId }),
    trackSpawn: (sessionId: SessionId, title: string) => this.command("track.spawn", { sessionId, title }),
    trackStop: (trackId: string) => this.command("track.stop", { trackId }),
    settingsUpdate: (patch: Partial<Settings>) => this.command("settings.update", patch),
  };

  private command(command: AdapterCommandName, payload: unknown) {
    return this.transport.sendCommand(command, payload);
  }
}

export class RealAdapterTransport implements AdapterTransport {
  private ws?: WebSocket;
  private handlers = new Set<(envelope: WsEnvelope) => void>();
  private requestSeq = 0;

  constructor(
    private httpUrl = import.meta.env.VITE_ADAPTER_HTTP_URL ?? "http://127.0.0.1:5178",
    private wsUrl = import.meta.env.VITE_ADAPTER_WS_URL ?? "ws://127.0.0.1:5178",
  ) {}

  connect(projectId: ProjectId, lastEventId?: string) {
    const params = new URLSearchParams({ projectId });
    if (lastEventId) params.set("lastEventId", lastEventId);
    this.ws?.close();
    this.ws = new WebSocket(`${this.wsUrl}/v1/ws?${params.toString()}`);
    this.ws.onopen = () => this.emitRuntimeStatus("connected", projectId);
    this.ws.onclose = () => this.emitRuntimeStatus("disconnected", projectId);
    this.ws.onerror = () => this.emitRuntimeStatus("error", projectId);
    this.ws.onmessage = (event) => this.emit(mapEnvelope(JSON.parse(event.data)));
  }

  close() {
    this.ws?.close();
  }

  onEnvelope(handler: (envelope: WsEnvelope) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  sendCommand(command: AdapterCommandName, payload: unknown) {
    const envelope: WsCommandEnvelope = {
      type: "command",
      requestId: `req_${++this.requestSeq}`,
      command,
      payload,
    };
    this.ws?.send(JSON.stringify(envelope));
    return Promise.resolve({ type: "ack", requestId: envelope.requestId } satisfies WsAckEnvelope);
  }

  getHealth() {
    return this.fetchJson<any>("/v1/health").then((health) => ({ ok: Boolean(health.healthy), mode: "real" as const }));
  }
  getProjects() {
    return this.fetchJson<any[]>("/v1/projects").then((projects) => projects.map(mapProject));
  }
  getCurrentProject() {
    return this.fetchJson<any>("/v1/projects/current").then(mapProject);
  }
  selectProject(projectId: ProjectId) {
    return this.fetchJson<any>("/v1/projects/select", { method: "POST", body: JSON.stringify({ projectId }) }).then(mapProject);
  }
  getSessions(projectId: ProjectId, group: SessionGroup) {
    return this.fetchJson<{ sessions: any[] }>(`/v1/sessions?projectId=${projectId}&group=${group}`).then((body) =>
      body.sessions.map((session) => mapSession(session, group)),
    );
  }
  createSession(projectId: ProjectId) {
    return this.fetchJson<{ session: any }>("/v1/sessions", { method: "POST", body: JSON.stringify({ projectId }) }).then((body) =>
      mapSession(body.session),
    );
  }
  getSession(sessionId: SessionId) {
    return this.fetchJson<{ session: any }>(`/v1/sessions/${sessionId}`).then((body) => mapSession(body.session));
  }
  patchSession(sessionId: SessionId, patch: Partial<SessionSnapshot>) {
    return this.fetchJson<{ session: any }>(`/v1/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ title: patch.title }) }).then((body) =>
      mapSession(body.session),
    );
  }
  deleteSession(sessionId: SessionId) {
    return this.fetchJson<{ deleted: boolean }>(`/v1/sessions/${sessionId}`, { method: "DELETE" }).then(() => ({ ok: true as const }));
  }
  getMessages(sessionId: SessionId) {
    return this.fetchJson<{ messages: any[] }>(`/v1/sessions/${sessionId}/messages`).then((body) => body.messages.map(mapMessage));
  }
  getTracks(sessionId: SessionId) {
    return this.fetchJson<{ tracks: any[] }>(`/v1/sessions/${sessionId}/tracks`).then((body) => body.tracks.map(mapTrack));
  }
  stopSession(sessionId: SessionId) {
    return this.fetchJson<any>(`/v1/sessions/${sessionId}/stop`, { method: "POST" }).then(() => ({ ok: true as const }));
  }
  getFilesTree(projectId: ProjectId, path = "") {
    return this.fetchJson<{ files: FileNode[] }>(`/v1/files/tree?projectId=${projectId}&path=${encodeURIComponent(path)}`).then((body) => body.files);
  }
  getFileContent(projectId: ProjectId, path: string) {
    return this.fetchJson<{ file: { path: string; content: string } }>(`/v1/files/content?projectId=${projectId}&path=${encodeURIComponent(path)}`).then((body) => body.file);
  }
  searchFiles(projectId: ProjectId, q: string) {
    return this.fetchJson<{ files: FileNode[] }>(`/v1/files/search?projectId=${projectId}&q=${encodeURIComponent(q)}`).then((body) => body.files);
  }
  upload(fileName: string) {
    return this.fetchJson<{ uploadId: string; name: string }>("/v1/uploads", { method: "POST", body: JSON.stringify({ fileName }) });
  }
  getArtifacts(projectId: ProjectId, sessionId: SessionId) {
    return this.fetchJson<{ artifacts: any[] }>(`/v1/artifacts?projectId=${projectId}&sessionId=${sessionId}`).then((body) =>
      body.artifacts.map(mapArtifact),
    );
  }
  getArtifact(artifactId: ArtifactId) {
    return this.fetchJson<{ artifact: any }>(`/v1/artifacts/${artifactId}`).then((body) => mapArtifact(body.artifact));
  }
  patchArtifact(artifactId: ArtifactId, patch: Partial<ArtifactMetadata>) {
    return this.fetchJson<{ artifact: any }>(`/v1/artifacts/${artifactId}`, { method: "PATCH", body: JSON.stringify(patch) }).then((body) =>
      mapArtifact(body.artifact),
    );
  }
  deleteArtifact(artifactId: ArtifactId) {
    return this.fetchJson<{ deleted: boolean }>(`/v1/artifacts/${artifactId}`, { method: "DELETE" }).then(() => ({ ok: true as const }));
  }
  getArtifactVersions(artifactId: ArtifactId) {
    return this.fetchJson<{ versions: any[] }>(`/v1/artifacts/${artifactId}/versions`).then((body) => body.versions.map(mapArtifactVersion));
  }
  getProvenance(artifactId: ArtifactId, versionId: VersionId) {
    return this.fetchJson<any>(`/v1/artifacts/${artifactId}/versions/${versionId}/provenance`).then(mapProvenance);
  }
  getDownloadUrl(artifactId: ArtifactId, versionId?: VersionId) {
    return Promise.resolve({ url: `${this.httpUrl}/v1/artifacts/${artifactId}/versions/${versionId ?? "current"}/download` });
  }
  getPermissions() {
    return this.fetchJson<{ permissions: any[] | Record<string, any> }>("/v1/permissions").then((body) => toArray(body.permissions).map(mapPermission));
  }
  revokePermission(permissionId: PermissionId) {
    return this.fetchJson<any>("/v1/permissions/revoke", { method: "POST", body: JSON.stringify({ permissionId }) }).then(() => ({ ok: true as const }));
  }
  getSettings() {
    return this.fetchJson<any>("/v1/settings").then((body) => mapSettings(body.settings));
  }
  patchSettings(patch: Partial<Settings>) {
    return this.fetchJson<any>("/v1/settings", { method: "PATCH", body: JSON.stringify(patch) }).then((body) => mapSettings(body.settings));
  }
  getConnectors() {
    return this.fetchJson<{ connectors: any[] | Record<string, any> }>("/v1/connectors").then((body) => toArray(body.connectors).map(mapConnector));
  }
  getSkills() {
    return this.fetchJson<{ skills: any[] | Record<string, any> }>("/v1/skills").then((body) => toArray(body.skills).map(mapSkill));
  }
  getSpecialists() {
    return this.fetchJson<{ specialists: any[] | Record<string, any> }>("/v1/specialists").then((body) => toArray(body.specialists).map(mapSpecialist));
  }

  private emit(envelope: WsEnvelope) {
    this.handlers.forEach((handler) => handler(envelope));
  }

  private emitRuntimeStatus(status: "connected" | "disconnected" | "error", projectId?: ProjectId) {
    this.emit({
      type: "event",
      eventId: `local_runtime_${Date.now()}`,
      seq: ++this.requestSeq,
      name: "runtime.statusChanged",
      payload: { status, mode: "real", projectId },
    });
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.httpUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      throw new Error(`Adapter request failed: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }
}

function toArray<T = any>(value: T[] | Record<string, T> | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

function mapEnvelope(envelope: any): WsEnvelope {
  if (envelope?.type !== "event") return envelope as WsEnvelope;
  const payload = envelope.payload ?? {};
  switch (envelope.name as AdapterEventName) {
    case "session.created":
    case "session.updated":
      return { ...envelope, payload: { ...payload, session: mapSession(payload.session) } };
    case "session.statusChanged":
      return { ...envelope, payload: { ...payload, sessionId: payload.session?.id ?? payload.sessionId, status: mapSessionStatus(payload.status) } };
    case "message.created":
      return { ...envelope, payload: { ...payload, message: payload.message ? mapMessage(payload.message) : mapCreatedMessage(payload) } };
    case "message.completed":
      return { ...envelope, payload: { ...payload, messageId: payload.message?.id ?? payload.messageId, message: payload.message ? mapMessage(payload.message) : undefined } };
    case "tool.started":
    case "tool.output":
    case "tool.completed":
    case "tool.failed":
      return { ...envelope, payload: { ...payload, tool: mapTool(payload) } };
    case "permission.requested":
      return { ...envelope, payload: { ...payload, permission: mapPermission(payload.permission) } };
    case "permission.resolved":
      return {
        ...envelope,
        payload: {
          ...payload,
          permissionId: payload.permission?.id,
          decision: payload.permission?.status === "approved" ? "approve" : "deny",
          permission: mapPermission(payload.permission),
        },
      };
    case "plan.proposed":
    case "plan.updated":
    case "plan.approved":
    case "plan.completed":
      return { ...envelope, payload: { ...payload, plan: payload.plan ? mapPlan(payload.plan) : undefined, planId: payload.plan?.id ?? payload.planId, status: payload.plan?.status ?? payload.status } };
    case "artifact.created":
    case "artifact.updated":
      return { ...envelope, payload: { ...payload, artifact: mapArtifact(payload.artifact) } };
    case "artifact.versionCreated":
      return { ...envelope, payload: { ...payload, version: mapArtifactVersion(payload.version) } };
    case "annotation.staged":
      return { ...envelope, payload: { ...payload, annotation: mapAnnotation(payload.annotation) } };
    case "annotation.committed":
      return { ...envelope, payload: { ...payload, annotationIds: payload.clearedAnnotationIds ?? payload.annotationIds } };
    case "review.findings":
      return { ...envelope, payload: { ...payload, findings: (payload.findings ?? []).map(mapReviewerFinding) } };
    case "track.created":
    case "track.statusChanged":
    case "track.completed":
      return { ...envelope, payload: { ...payload, track: mapTrack(payload.track), trackId: payload.track?.id, status: mapTrackStatus(payload.status ?? payload.track?.status) } };
    case "remoteJob.submitted":
    case "remoteJob.statusChanged":
      return { ...envelope, payload: { ...payload, job: mapRemoteJob(payload.job), status: mapRemoteJobStatus(payload.status ?? payload.job?.status) } };
    case "remoteJob.logAppended":
      return { ...envelope, payload: { ...payload, jobId: payload.jobId, log: payload.log } };
    default:
      return envelope as WsEnvelope;
  }
}

function mapProject(project: any): ProjectSnapshot {
  return {
    projectId: project?.projectId ?? project?.id ?? "proj_local",
    name: project?.name ?? "OpenClaudeScience",
    description: project?.description ?? project?.path ?? "",
    current: project?.current ?? project?.selected ?? true,
    rootPath: project?.rootPath ?? project?.path,
    updatedAt: project?.updatedAt ?? new Date().toISOString(),
  };
}

function mapSession(session: any, group: SessionGroup = "all"): SessionSnapshot {
  return {
    sessionId: session?.sessionId ?? session?.id,
    projectId: session?.projectId ?? "proj_local",
    title: session?.title ?? "Untitled session",
    group,
    status: mapSessionStatus(session?.status),
    summary: session?.summary ?? "",
    updatedAt: session?.updatedAt ?? session?.createdAt ?? new Date().toISOString(),
  };
}

function mapSessionStatus(status: string | undefined): SessionSnapshot["status"] {
  if (status === "stopped") return "completed";
  if (status === "error") return "failed";
  if (status === "blocked" || status === "completed" || status === "failed" || status === "reviewing" || status === "running") return status;
  return "idle";
}

function mapCreatedMessage(payload: any): Message {
  return {
    messageId: payload.messageId,
    sessionId: payload.sessionId,
    role: "user",
    parts: payload.parts ?? [],
    status: "completed",
    annotationIds: payload.annotationIds,
    createdAt: new Date().toISOString(),
  };
}

function mapMessage(message: any): Message {
  return {
    messageId: message?.messageId ?? message?.id,
    sessionId: message?.sessionId,
    role: message?.role === "assistant" || message?.role === "system" || message?.role === "user" ? message.role : "assistant",
    parts: (message?.parts ?? []).map(mapMessagePart),
    status: message?.status === "error" ? "failed" : message?.status === "running" ? "streaming" : "completed",
    createdAt: message?.createdAt ?? new Date().toISOString(),
  };
}

function mapMessagePart(part: any): MessagePart {
  if (part?.type === "text") return { type: "text", text: typeof part.text === "string" ? part.text : "" };
  return { type: "text", text: "" };
}

function mapArtifact(artifact: any): ArtifactMetadata {
  return {
    id: artifact?.id,
    projectId: artifact?.projectId ?? "proj_local",
    sessionId: artifact?.sessionId,
    kind: artifact?.kind ?? "unknown",
    name: artifact?.name ?? "artifact",
    currentVersionId: artifact?.currentVersionId,
    mimeType: artifact?.mimeType ?? "application/octet-stream",
    starred: Boolean(artifact?.starred),
    createdAt: artifact?.createdAt ?? new Date().toISOString(),
    updatedAt: artifact?.updatedAt ?? artifact?.createdAt ?? new Date().toISOString(),
  };
}

function mapArtifactVersion(version: any): ArtifactVersion {
  return {
    artifactId: version?.artifactId,
    versionId: version?.versionId ?? version?.id,
    label: version?.label ?? `v${version?.version ?? 1}`,
    createdAt: version?.createdAt ?? new Date().toISOString(),
    authorMessageId: version?.sourceMessageIds?.[0],
    preview: { kind: "unknown", text: version?.mimeType ?? "Artifact preview pending" },
  };
}

function mapProvenance(provenance: any): ProvenanceRecord {
  return {
    artifactId: provenance?.artifactId,
    versionId: provenance?.versionId,
    tabs: {
      messages: provenance?.tabs?.messages ?? [],
      code: (provenance?.tabs?.code ?? []).map((entry: any) => ({ language: entry.language, downloadUrl: entry.downloadUrl ?? "", code: entry.content })),
      executionLog: (provenance?.tabs?.executionLog ?? []).map((entry: any) => ({
        stepId: entry.stepId,
        kind: entry.kind,
        stdout: entry.stdout ?? "",
        stderr: entry.stderr ?? "",
        exitCode: entry.exitCode ?? 0,
      })),
      environment: {
        python: provenance?.tabs?.environment?.provided?.python ?? "",
        packages: [],
        cwd: provenance?.tabs?.environment?.adapter?.storage ?? "",
        git: provenance?.tabs?.environment?.runtime?.kind,
      },
      review: (provenance?.tabs?.review ?? []).map((entry: any) => ({ findingId: entry.findingId, severity: entry.severity ?? "info" })),
    },
  };
}

function mapPermission(permission: any): PermissionRequest {
  return {
    id: permission?.id,
    sessionId: permission?.sessionId,
    type: permission?.type ?? "shell",
    title: permission?.title ?? "Permission",
    summary: permission?.summary ?? "",
    details: permission?.details ?? {},
    scopes: permission?.scopes ?? ["once"],
    recommendedScope: permission?.recommendedScope ?? "once",
    risk: permission?.risk ?? "medium",
    status: permission?.status ?? "pending",
    createdAt: permission?.createdAt ?? new Date().toISOString(),
  };
}

function mapAnnotation(annotation: any): Annotation {
  return {
    annotationId: annotation?.annotationId ?? annotation?.id,
    artifactId: annotation?.artifactId,
    versionId: annotation?.versionId,
    sessionId: annotation?.sessionId,
    target: annotation?.target ?? { type: "text", quote: annotation?.body ?? "" },
    note: annotation?.note ?? annotation?.body ?? "",
    status: annotation?.status ?? "staged",
    createdAt: annotation?.createdAt ?? new Date().toISOString(),
  };
}

function mapReviewerFinding(finding: any): ReviewerFinding {
  return {
    findingId: finding?.findingId ?? finding?.id,
    sessionId: finding?.sessionId ?? "",
    artifactId: finding?.artifactId,
    versionId: finding?.versionId,
    severity: finding?.severity ?? "info",
    claim: finding?.claim ?? "",
    evidence: finding?.evidence ?? "",
    recommendation: finding?.recommendation ?? "",
    status: finding?.status ?? "open",
  };
}

function mapTool(payload: any): ToolEvent {
  return {
    toolId: payload.toolStepId ?? payload.tool?.toolId,
    sessionId: payload.sessionId,
    kind: payload.kind ?? "shell",
    title: payload.title ?? payload.tool ?? "Tool",
    stdout: payload.stdout ?? payload.output,
    stderr: payload.stderr,
    exitCode: payload.exitCode,
    status: payload.status ?? "running",
    createdAt: new Date().toISOString(),
  };
}

function mapPlan(plan: any): PlanState {
  return {
    planId: plan?.planId ?? plan?.id,
    sessionId: plan?.sessionId,
    title: plan?.title ?? "Plan",
    summary: plan?.summary ?? "",
    status: plan?.status === "awaiting_approval" ? "proposed" : plan?.status ?? "proposed",
    steps: (plan?.steps ?? []).map((step: any) => ({ id: step.id, title: step.title, status: step.status ?? "pending" })),
  };
}

function mapTrack(track: any): Track {
  return {
    trackId: track?.trackId ?? track?.id,
    sessionId: track?.sessionId,
    title: track?.title ?? "Track",
    status: mapTrackStatus(track?.status),
    messages: track?.messages ?? (track?.message ? [track.message] : []),
    progress: track?.progress ?? (track?.status === "completed" ? 100 : 0),
  };
}

function mapTrackStatus(status: string | undefined): Track["status"] {
  if (status === "cancelled") return "stopped";
  if (status === "blocked") return "running";
  if (status === "failed" || status === "completed" || status === "running" || status === "queued" || status === "stopped") return status;
  return "running";
}

function mapRemoteJob(job: any): RemoteJob {
  return {
    jobId: job?.jobId ?? job?.id,
    sessionId: job?.sessionId,
    title: job?.title ?? "Remote job",
    status: mapRemoteJobStatus(job?.status),
    logs: (job?.logs ?? []).map((log: any) => (typeof log === "string" ? log : log.text ?? "")),
    artifactIds: job?.artifactIds ?? [],
  };
}

function mapRemoteJobStatus(status: string | undefined): RemoteJob["status"] {
  if (status === "succeeded") return "completed";
  if (status === "cancelled") return "failed";
  if (status === "failed" || status === "completed" || status === "running" || status === "queued") return status;
  return "queued";
}

function mapSettings(settings: any): Settings {
  return {
    theme: "bio-lab-glass",
    defaultProjectId: settings?.defaultProjectId ?? "proj_local",
    notifications: settings?.notifications ?? true,
    rightPanelBehavior: settings?.rightPanelBehavior ?? "pin",
    networkAllowlist: settings?.networkAllowlist ?? [],
    memoryEnabled: settings?.memoryEnabled ?? false,
    storageRetentionDays: settings?.storageRetentionDays ?? 30,
  };
}

function mapConnector(connector: any): Connector {
  return {
    id: connector?.id ?? connector?.name ?? "connector",
    name: connector?.name ?? connector?.id ?? "Connector",
    status: connector?.status ?? "available",
    description: connector?.description ?? "",
  };
}

function mapSkill(skill: any): Skill {
  return {
    id: skill?.id ?? skill?.name ?? "skill",
    name: skill?.name ?? skill?.id ?? "Skill",
    enabled: skill?.enabled ?? true,
    description: skill?.description ?? "",
  };
}

function mapSpecialist(specialist: any): Specialist {
  return {
    id: specialist?.id ?? specialist?.name ?? "specialist",
    name: specialist?.name ?? specialist?.id ?? "Specialist",
    policy: specialist?.policy ?? "",
    enabled: specialist?.enabled ?? true,
  };
}

export const adapterClient = new AdapterClient(
  import.meta.env.VITE_ADAPTER_MODE === "real" ? new RealAdapterTransport() : new MockAdapterTransport(),
);
