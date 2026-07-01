import type {
  AdapterCommandName,
  AdapterSnapshots,
  ArtifactId,
  ArtifactMetadata,
  ArtifactVersion,
  Connector,
  FileNode,
  PermissionId,
  PermissionScope,
  ProjectId,
  ProjectSnapshot,
  ProvenanceRecord,
  SessionGroup,
  SessionId,
  SessionSnapshot,
  Settings,
  Skill,
  Specialist,
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
    planApprove: (planId: string, sessionId: SessionId) => this.command("plan.approve", { planId, sessionId }),
    planRequestRevision: (planId: string, sessionId: SessionId, note: string) =>
      this.command("plan.requestRevision", { planId, sessionId, note }),
    artifactOpen: (artifactId: ArtifactId, versionId?: VersionId) => this.command("artifact.open", { artifactId, versionId }),
    artifactStar: (artifactId: ArtifactId, starred: boolean) => this.command("artifact.star", { artifactId, starred }),
    artifactRename: (artifactId: ArtifactId, name: string) => this.command("artifact.rename", { artifactId, name }),
    artifactDelete: (artifactId: ArtifactId) => this.command("artifact.delete", { artifactId }),
    artifactDownloadUrl: (artifactId: ArtifactId, versionId?: VersionId) => this.command("artifact.downloadUrl", { artifactId, versionId }),
    annotationStage: (payload: unknown) => this.command("annotation.stage", payload),
    annotationDiscard: (annotationId: string) => this.command("annotation.discard", { annotationId }),
    annotationCommitWithMessage: (payload: unknown) => this.command("annotation.commitWithMessage", payload),
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
    private httpUrl = import.meta.env.VITE_ADAPTER_HTTP_URL ?? "http://127.0.0.1:4317",
    private wsUrl = import.meta.env.VITE_ADAPTER_WS_URL ?? "ws://127.0.0.1:4317",
  ) {}

  connect(projectId: ProjectId, lastEventId?: string) {
    const params = new URLSearchParams({ projectId });
    if (lastEventId) params.set("lastEventId", lastEventId);
    this.ws?.close();
    this.ws = new WebSocket(`${this.wsUrl}/v1/ws?${params.toString()}`);
    this.ws.onmessage = (event) => this.emit(JSON.parse(event.data) as WsEnvelope);
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
    return this.fetchJson<{ ok: boolean; mode: "mock" | "real" }>("/v1/health");
  }
  getProjects() {
    return this.fetchJson<ProjectSnapshot[]>("/v1/projects");
  }
  getCurrentProject() {
    return this.fetchJson<ProjectSnapshot>("/v1/projects/current");
  }
  selectProject(projectId: ProjectId) {
    return this.fetchJson<ProjectSnapshot>("/v1/projects/select", { method: "POST", body: JSON.stringify({ projectId }) });
  }
  getSessions(projectId: ProjectId, group: SessionGroup) {
    return this.fetchJson<SessionSnapshot[]>(`/v1/sessions?projectId=${projectId}&group=${group}`);
  }
  createSession(projectId: ProjectId) {
    return this.fetchJson<SessionSnapshot>("/v1/sessions", { method: "POST", body: JSON.stringify({ projectId }) });
  }
  getSession(sessionId: SessionId) {
    return this.fetchJson<SessionSnapshot>(`/v1/sessions/${sessionId}`);
  }
  patchSession(sessionId: SessionId, patch: Partial<SessionSnapshot>) {
    return this.fetchJson<SessionSnapshot>(`/v1/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  deleteSession(sessionId: SessionId) {
    return this.fetchJson<{ ok: true }>(`/v1/sessions/${sessionId}`, { method: "DELETE" });
  }
  getMessages(sessionId: SessionId) {
    return this.fetchJson<AdapterSnapshots["messages"][SessionId]>(`/v1/sessions/${sessionId}/messages`);
  }
  getTracks(sessionId: SessionId) {
    return this.fetchJson<AdapterSnapshots["tracks"][SessionId]>(`/v1/sessions/${sessionId}/tracks`);
  }
  stopSession(sessionId: SessionId) {
    return this.fetchJson<{ ok: true }>(`/v1/sessions/${sessionId}/stop`, { method: "POST" });
  }
  getFilesTree(projectId: ProjectId, path = "") {
    return this.fetchJson<FileNode[]>(`/v1/files/tree?projectId=${projectId}&path=${encodeURIComponent(path)}`);
  }
  getFileContent(projectId: ProjectId, path: string) {
    return this.fetchJson<{ path: string; content: string }>(`/v1/files/content?projectId=${projectId}&path=${encodeURIComponent(path)}`);
  }
  searchFiles(projectId: ProjectId, q: string) {
    return this.fetchJson<FileNode[]>(`/v1/files/search?projectId=${projectId}&q=${encodeURIComponent(q)}`);
  }
  upload(fileName: string) {
    return this.fetchJson<{ uploadId: string; name: string }>("/v1/uploads", { method: "POST", body: JSON.stringify({ fileName }) });
  }
  getArtifacts(projectId: ProjectId, sessionId: SessionId) {
    return this.fetchJson<ArtifactMetadata[]>(`/v1/artifacts?projectId=${projectId}&sessionId=${sessionId}`);
  }
  getArtifact(artifactId: ArtifactId) {
    return this.fetchJson<ArtifactMetadata>(`/v1/artifacts/${artifactId}`);
  }
  patchArtifact(artifactId: ArtifactId, patch: Partial<ArtifactMetadata>) {
    return this.fetchJson<ArtifactMetadata>(`/v1/artifacts/${artifactId}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  deleteArtifact(artifactId: ArtifactId) {
    return this.fetchJson<{ ok: true }>(`/v1/artifacts/${artifactId}`, { method: "DELETE" });
  }
  getArtifactVersions(artifactId: ArtifactId) {
    return this.fetchJson<ArtifactVersion[]>(`/v1/artifacts/${artifactId}/versions`);
  }
  getProvenance(artifactId: ArtifactId, versionId: VersionId) {
    return this.fetchJson<ProvenanceRecord>(`/v1/artifacts/${artifactId}/versions/${versionId}/provenance`);
  }
  getDownloadUrl(artifactId: ArtifactId, versionId?: VersionId) {
    const suffix = versionId ? `?versionId=${versionId}` : "";
    return this.fetchJson<{ url: string }>(`/v1/artifacts/${artifactId}/versions/${versionId ?? "current"}/download${suffix}`);
  }
  getPermissions() {
    return this.fetchJson<AdapterSnapshots["permissions"]>("/v1/permissions");
  }
  revokePermission(permissionId: PermissionId) {
    return this.fetchJson<{ ok: true }>("/v1/permissions/revoke", { method: "POST", body: JSON.stringify({ permissionId }) });
  }
  getSettings() {
    return this.fetchJson<Settings>("/v1/settings");
  }
  patchSettings(patch: Partial<Settings>) {
    return this.fetchJson<Settings>("/v1/settings", { method: "PATCH", body: JSON.stringify(patch) });
  }
  getConnectors() {
    return this.fetchJson<Connector[]>("/v1/connectors");
  }
  getSkills() {
    return this.fetchJson<Skill[]>("/v1/skills");
  }
  getSpecialists() {
    return this.fetchJson<Specialist[]>("/v1/specialists");
  }

  private emit(envelope: WsEnvelope) {
    this.handlers.forEach((handler) => handler(envelope));
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

export const adapterClient = new AdapterClient(
  import.meta.env.VITE_ADAPTER_MODE === "real" ? new RealAdapterTransport() : new MockAdapterTransport(),
);
