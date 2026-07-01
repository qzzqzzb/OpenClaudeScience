import { snapshots as baseSnapshots, reviewerFindings, toolEvents } from "../fixtures/scenarios";
import type {
  AdapterCommandName,
  AdapterSnapshots,
  Annotation,
  ArtifactId,
  ArtifactMetadata,
  ArtifactVersion,
  FileNode,
  MessagePart,
  PermissionId,
  PermissionScope,
  ProjectId,
  ProjectSnapshot,
  ProvenanceRecord,
  SessionGroup,
  SessionId,
  SessionSnapshot,
  Settings,
  VersionId,
  WsAckEnvelope,
  WsEnvelope,
  WsEventEnvelope,
} from "./types";
import type { AdapterTransport } from "./client";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function eventId(seq: number) {
  return `evt_${String(seq).padStart(4, "0")}`;
}

export class MockAdapterTransport implements AdapterTransport {
  private state: AdapterSnapshots = clone(baseSnapshots);
  private currentProjectId = "proj_cross_species";
  private seq = 0;
  private requestSeq = 0;
  private handlers = new Set<(envelope: WsEnvelope) => void>();
  private history: WsEventEnvelope[] = [];

  connect(projectId: ProjectId, lastEventId?: string) {
    this.currentProjectId = projectId;
    if (lastEventId) {
      const missed = this.history.filter((event) => event.eventId > lastEventId);
      missed.forEach((event) => this.emitLater(event, 20));
    } else {
      this.push("runtime.statusChanged", { status: "connected", mode: "mock", projectId }, undefined, 60);
    }
  }

  close() {
    this.push("runtime.statusChanged", { status: "disconnected", mode: "mock" }, undefined, 0);
  }

  onEnvelope(handler: (envelope: WsEnvelope) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async sendCommand(command: AdapterCommandName, payload: any): Promise<WsAckEnvelope> {
    const ack: WsAckEnvelope = { type: "ack", requestId: `req_${++this.requestSeq}` };
    this.emit(ack);
    this.simulateCommand(command, payload);
    return ack;
  }

  async getHealth() {
    return { ok: true, mode: "mock" as const };
  }

  async getProjects() {
    return clone(this.state.projects);
  }

  async getCurrentProject() {
    return clone(this.state.projects.find((project) => project.projectId === this.currentProjectId) ?? this.state.projects[0]);
  }

  async selectProject(projectId: ProjectId) {
    this.currentProjectId = projectId;
    this.state.projects = this.state.projects.map((project) => ({ ...project, current: project.projectId === projectId }));
    return this.getCurrentProject();
  }

  async getSessions(projectId: ProjectId, group: SessionGroup) {
    return clone(
      this.state.sessions.filter((session) => session.projectId === projectId && (group === "all" || session.group === group)),
    );
  }

  async createSession(projectId: ProjectId) {
    const count = this.state.sessions.length + 1;
    const session: SessionSnapshot = {
      sessionId: `ses_new_${count}`,
      projectId,
      title: "Untitled investigation",
      group: "active",
      status: "idle",
      summary: "New adapter-backed session.",
      updatedAt: new Date().toISOString(),
    };
    this.state.sessions.unshift(session);
    this.state.messages[session.sessionId] = [];
    this.state.artifacts[session.sessionId] = [];
    this.state.tracks[session.sessionId] = [];
    this.state.jobs[session.sessionId] = [];
    return clone(session);
  }

  async getSession(sessionId: SessionId) {
    const session = this.state.sessions.find((item) => item.sessionId === sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    return clone(session);
  }

  async patchSession(sessionId: SessionId, patch: Partial<SessionSnapshot>) {
    this.state.sessions = this.state.sessions.map((session) => (session.sessionId === sessionId ? { ...session, ...patch } : session));
    return this.getSession(sessionId);
  }

  async deleteSession(sessionId: SessionId) {
    this.state.sessions = this.state.sessions.filter((session) => session.sessionId !== sessionId);
    return { ok: true as const };
  }

  async getMessages(sessionId: SessionId) {
    return clone(this.state.messages[sessionId] ?? []);
  }

  async getTracks(sessionId: SessionId) {
    return clone(this.state.tracks[sessionId] ?? []);
  }

  async stopSession(sessionId: SessionId) {
    this.state.sessions = this.state.sessions.map((session) =>
      session.sessionId === sessionId ? { ...session, status: "idle" as const } : session,
    );
    return { ok: true as const };
  }

  async getFilesTree(_projectId: ProjectId, _path = "") {
    return clone(this.state.files);
  }

  async getFileContent(_projectId: ProjectId, path: string) {
    return {
      path,
      content: `# ${path}\n\nThis content is served by the adapter file API. The UI never infers local paths from chat text.`,
    };
  }

  async searchFiles(_projectId: ProjectId, q: string) {
    const flatten = (nodes: FileNode[]): FileNode[] => nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
    return clone(flatten(this.state.files).filter((node) => node.name.toLowerCase().includes(q.toLowerCase())));
  }

  async upload(fileName: string) {
    return { uploadId: `upl_${Date.now()}`, name: fileName };
  }

  async getArtifacts(_projectId: ProjectId, sessionId: SessionId) {
    return clone(this.state.artifacts[sessionId] ?? []);
  }

  async getArtifact(artifactId: ArtifactId) {
    const artifact = Object.values(this.state.artifacts)
      .flat()
      .find((item) => item.id === artifactId);
    if (!artifact) throw new Error(`Unknown artifact ${artifactId}`);
    return clone(artifact);
  }

  async patchArtifact(artifactId: ArtifactId, patch: Partial<ArtifactMetadata>) {
    for (const sessionId of Object.keys(this.state.artifacts)) {
      this.state.artifacts[sessionId] = this.state.artifacts[sessionId].map((artifact) =>
        artifact.id === artifactId ? { ...artifact, ...patch, updatedAt: new Date().toISOString() } : artifact,
      );
    }
    return this.getArtifact(artifactId);
  }

  async deleteArtifact(artifactId: ArtifactId) {
    for (const sessionId of Object.keys(this.state.artifacts)) {
      this.state.artifacts[sessionId] = this.state.artifacts[sessionId].filter((artifact) => artifact.id !== artifactId);
    }
    return { ok: true as const };
  }

  async getArtifactVersions(artifactId: ArtifactId) {
    return clone(this.state.versions[artifactId] ?? []);
  }

  async getProvenance(artifactId: ArtifactId, versionId: VersionId) {
    const key = `${artifactId}:${versionId}`;
    const record = this.state.provenance[key] ?? this.emptyProvenance(artifactId, versionId);
    return clone(record);
  }

  async getDownloadUrl(artifactId: ArtifactId, versionId?: VersionId) {
    return { url: `/v1/artifacts/${artifactId}/versions/${versionId ?? "current"}/download` };
  }

  async getPermissions() {
    return clone(this.state.permissions);
  }

  async revokePermission(permissionId: PermissionId) {
    this.state.permissions = this.state.permissions.map((permission) =>
      permission.id === permissionId ? { ...permission, status: "denied" as const } : permission,
    );
    return { ok: true as const };
  }

  async getSettings() {
    return clone(this.state.settings);
  }

  async patchSettings(patch: Partial<Settings>) {
    this.state.settings = { ...this.state.settings, ...patch };
    return clone(this.state.settings);
  }

  async getConnectors() {
    return clone(this.state.connectors);
  }

  async getSkills() {
    return clone(this.state.skills);
  }

  async getSpecialists() {
    return clone(this.state.specialists);
  }

  private simulateCommand(command: AdapterCommandName, payload: any) {
    switch (command) {
      case "project.select":
        this.currentProjectId = payload.projectId;
        this.push("runtime.statusChanged", { status: "project-selected", projectId: payload.projectId });
        break;
      case "session.create":
        void this.createSession(payload.projectId).then((session) => this.push("session.created", { session }, session.sessionId));
        break;
      case "session.open":
        this.push("session.updated", { sessionId: payload.sessionId, opened: true }, payload.sessionId);
        if (this.state.plans[payload.sessionId]) {
          this.push("plan.proposed", { plan: this.state.plans[payload.sessionId] }, payload.sessionId, 80);
        }
        toolEvents
          .filter((tool) => tool.sessionId === payload.sessionId)
          .forEach((tool, index) => this.push("tool.completed", { tool }, payload.sessionId, 120 + index * 80));
        reviewerFindings
          .filter((finding) => finding.sessionId === payload.sessionId)
          .forEach((finding, index) => this.push("review.findings", { findings: [finding] }, payload.sessionId, 180 + index * 80));
        (this.state.jobs[payload.sessionId] ?? []).forEach((job, index) =>
          this.push("remoteJob.statusChanged", { job }, payload.sessionId, 240 + index * 80),
        );
        break;
      case "session.stop":
        this.state.tracks[payload.sessionId] = (this.state.tracks[payload.sessionId] ?? []).map((track) => ({
          ...track,
          status: track.status === "running" ? "stopped" : track.status,
        }));
        this.push("session.statusChanged", { sessionId: payload.sessionId, status: "idle" }, payload.sessionId);
        break;
      case "session.sendMessage":
        this.simulateSendMessage(payload);
        break;
      case "permission.respond":
        this.simulatePermission(payload.permissionId, payload.decision, payload.scope);
        break;
      case "plan.approve":
        this.push("plan.approved", { planId: payload.planId, status: "approved" }, payload.sessionId);
        this.push("plan.stepStarted", { planId: payload.planId, stepId: "step_dispatch" }, payload.sessionId, 400);
        break;
      case "plan.requestRevision":
        this.push("plan.updated", { planId: payload.planId, note: payload.note, status: "proposed" }, payload.sessionId);
        break;
      case "artifact.star":
        void this.patchArtifact(payload.artifactId, { starred: payload.starred }).then((artifact) =>
          this.push("artifact.updated", { artifact }, artifact.sessionId),
        );
        break;
      case "artifact.rename":
        void this.patchArtifact(payload.artifactId, { name: payload.name }).then((artifact) =>
          this.push("artifact.updated", { artifact }, artifact.sessionId),
        );
        break;
      case "artifact.delete":
        void this.getArtifact(payload.artifactId)
          .then((artifact) => this.deleteArtifact(payload.artifactId).then(() => this.push("artifact.deleted", { artifactId: payload.artifactId }, artifact.sessionId)))
          .catch(() => undefined);
        break;
      case "artifact.downloadUrl":
        this.push("artifact.updated", { downloadUrl: `/v1/artifacts/${payload.artifactId}/versions/${payload.versionId ?? "current"}/download` });
        break;
      case "annotation.stage":
        this.simulateStageAnnotation(payload);
        break;
      case "annotation.discard":
        this.state.annotations = this.state.annotations.filter((annotation) => annotation.annotationId !== payload.annotationId);
        this.push("annotation.committed", { annotationId: payload.annotationId, discarded: true });
        break;
      case "annotation.commitWithMessage":
        this.simulateCommitAnnotations(payload);
        break;
      case "reviewer.run":
        this.push("review.started", { sessionId: payload.sessionId, artifactId: payload.artifactId }, payload.sessionId);
        this.push("review.findings", { findings: reviewerFindings.filter((finding) => finding.sessionId === payload.sessionId) }, payload.sessionId, 700);
        this.push("review.completed", { sessionId: payload.sessionId }, payload.sessionId, 1100);
        break;
      case "track.spawn":
        this.simulateTrack(payload.sessionId, payload.title);
        break;
      case "track.stop":
        this.push("track.statusChanged", { trackId: payload.trackId, status: "stopped" });
        break;
      case "settings.update":
        this.state.settings = { ...this.state.settings, ...payload };
        this.push("runtime.statusChanged", { status: "settings-updated" });
        break;
      default:
        break;
    }
  }

  private simulateSendMessage(payload: { sessionId: SessionId; parts: MessagePart[]; annotationIds?: string[] }) {
    const sessionId = payload.sessionId;
    const createdAt = new Date().toISOString();
    const userMessage = {
      messageId: `msg_user_${Date.now()}`,
      sessionId,
      role: "user" as const,
      parts: payload.parts,
      annotationIds: payload.annotationIds ?? [],
      status: "completed" as const,
      createdAt,
    };
    const assistantId = `msg_asst_${Date.now()}`;
    this.state.messages[sessionId] = [...(this.state.messages[sessionId] ?? []), userMessage];
    this.push("message.created", { message: userMessage }, sessionId, 40);
    this.push(
      "message.created",
      {
        message: {
          messageId: assistantId,
          sessionId,
          role: "assistant",
          parts: [{ type: "text", text: "" }],
          status: "streaming",
          createdAt: new Date().toISOString(),
        },
      },
      sessionId,
      200,
    );
    this.push("message.delta", { messageId: assistantId, delta: "I routed this through the adapter command envelope. " }, sessionId, 450);
    this.push("tool.started", { tool: { ...toolEvents[0], toolId: `tool_${Date.now()}`, sessionId, status: "running" } }, sessionId, 650);
    this.push("message.delta", { messageId: assistantId, delta: "The artifact and reviewer state will update from normalized events." }, sessionId, 850);
    this.push("message.completed", { messageId: assistantId }, sessionId, 1300);
    if (payload.annotationIds?.length) {
      this.simulateCommitAnnotations({ sessionId, annotationIds: payload.annotationIds, text: "Committed with message" }, 1500);
    }
  }

  private simulatePermission(permissionId: PermissionId, decision: "approve" | "deny", scope?: PermissionScope) {
    this.state.permissions = this.state.permissions.map((permission) =>
      permission.id === permissionId
        ? { ...permission, status: decision === "approve" ? ("approved" as const) : ("denied" as const) }
        : permission,
    );
    this.push("permission.resolved", { permissionId, decision, scope });
  }

  private simulateStageAnnotation(payload: any) {
    const annotation: Annotation = {
      annotationId: `ann_${Date.now()}`,
      artifactId: payload.artifactId,
      versionId: payload.versionId,
      sessionId: payload.sessionId,
      target: payload.target,
      note: payload.note,
      status: "staged",
      createdAt: new Date().toISOString(),
    };
    this.state.annotations.push(annotation);
    this.push("annotation.staged", { annotation }, payload.sessionId);
  }

  private simulateCommitAnnotations(payload: { sessionId: SessionId; annotationIds: string[]; text?: string }, delay = 0) {
    this.state.annotations = this.state.annotations.map((annotation) =>
      payload.annotationIds.includes(annotation.annotationId) ? { ...annotation, status: "committed" as const } : annotation,
    );
    this.push("annotation.committed", { annotationIds: payload.annotationIds, text: payload.text }, payload.sessionId, delay);
  }

  private simulateTrack(sessionId: SessionId, title: string) {
    const track = {
      trackId: `track_${Date.now()}`,
      sessionId,
      title,
      status: "running" as const,
      messages: ["created by adapter command", "collecting evidence"],
      progress: 18,
    };
    this.state.tracks[sessionId] = [...(this.state.tracks[sessionId] ?? []), track];
    this.push("track.created", { track }, sessionId);
    this.push("track.message", { trackId: track.trackId, message: "found a candidate artifact" }, sessionId, 700);
    this.push("track.statusChanged", { trackId: track.trackId, status: "completed", progress: 100 }, sessionId, 1200);
  }

  private push(name: WsEventEnvelope["name"], payload: unknown, sessionId?: SessionId, delay = 120) {
    const event: WsEventEnvelope = {
      type: "event",
      eventId: eventId(++this.seq),
      seq: this.seq,
      sessionId,
      name,
      payload,
    };
    this.history.push(event);
    this.emitLater(event, delay);
  }

  private emitLater(envelope: WsEnvelope, delay: number) {
    window.setTimeout(() => this.emit(envelope), delay);
  }

  private emit(envelope: WsEnvelope) {
    this.handlers.forEach((handler) => handler(envelope));
  }

  private emptyProvenance(artifactId: ArtifactId, versionId: VersionId): ProvenanceRecord {
    return {
      artifactId,
      versionId,
      tabs: {
        messages: [],
        code: [],
        executionLog: [],
        environment: {
          python: "3.12.4",
          packages: [],
          cwd: "/adapter/mock",
        },
        review: [],
      },
    };
  }
}
