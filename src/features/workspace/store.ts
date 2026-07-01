import { create } from "zustand";
import { adapterClient } from "../../adapter/client";
import type {
  AdapterEventName,
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
  WsEnvelope,
  WsEventEnvelope,
} from "../../adapter/types";

type LeftMode = "sessions" | "files" | "settings";
type InspectorMode = "artifact" | "provenance" | "settings";
type ProvenanceTab = "messages" | "code" | "executionLog" | "environment" | "review";

interface Toast {
  id: string;
  text: string;
}

interface AppState {
  loading: boolean;
  runtimeStatus: string;
  projects: ProjectSnapshot[];
  currentProject?: ProjectSnapshot;
  sessionGroup: SessionGroup;
  sessions: SessionSnapshot[];
  activeSessionId?: SessionId;
  messages: Record<SessionId, Message[]>;
  artifacts: Record<SessionId, ArtifactMetadata[]>;
  versions: Record<ArtifactId, ArtifactVersion[]>;
  provenance: Record<string, ProvenanceRecord>;
  permissions: Record<PermissionId, PermissionRequestView>;
  annotations: Record<string, Annotation>;
  plans: Record<SessionId, PlanState>;
  tools: Record<string, ToolEvent>;
  tracks: Record<SessionId, Track[]>;
  jobs: Record<JobKey, RemoteJob>;
  findings: Record<string, ReviewerFinding>;
  settings?: Settings;
  connectors: Connector[];
  skills: Skill[];
  specialists: Specialist[];
  files: FileNode[];
  leftMode: LeftMode;
  inspectorMode: InspectorMode;
  provenanceTab: ProvenanceTab;
  activeArtifactId?: ArtifactId;
  activeVersionId?: VersionId;
  pendingParts: MessagePart[];
  lastEventId?: string;
  eventLog: WsEventEnvelope[];
  toasts: Toast[];
  initialize: () => Promise<void>;
  selectProject: (projectId: ProjectId) => Promise<void>;
  setSessionGroup: (group: SessionGroup) => Promise<void>;
  openSession: (sessionId: SessionId) => Promise<void>;
  createSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  renameSession: (sessionId: SessionId, title: string) => Promise<void>;
  deleteSession: (sessionId: SessionId) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  addPendingPart: (part: MessagePart) => void;
  attachUpload: (fileName: string) => Promise<void>;
  clearPendingParts: () => void;
  respondPermission: (permissionId: PermissionId, decision: "approve" | "deny", scope?: PermissionScope) => Promise<void>;
  approvePlan: (planId: string) => Promise<void>;
  requestPlanRevision: (planId: string) => Promise<void>;
  openArtifact: (artifactId: ArtifactId, mode?: InspectorMode) => Promise<void>;
  selectArtifactVersion: (artifactId: ArtifactId, versionId: VersionId) => Promise<void>;
  setProvenanceTab: (tab: ProvenanceTab) => void;
  starArtifact: (artifactId: ArtifactId, starred: boolean) => Promise<void>;
  renameArtifact: (artifactId: ArtifactId, name: string) => Promise<void>;
  deleteArtifact: (artifactId: ArtifactId) => Promise<void>;
  downloadArtifact: (artifactId: ArtifactId, versionId?: VersionId) => Promise<void>;
  stageAnnotation: (target: Annotation["target"], note: string) => Promise<void>;
  discardAnnotation: (annotationId: string) => Promise<void>;
  commitAnnotationsWithMessage: (text: string) => Promise<void>;
  runReviewer: () => Promise<void>;
  spawnTrack: () => Promise<void>;
  stopTrack: (trackId: string) => Promise<void>;
  revokePermission: (permissionId: PermissionId) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  setLeftMode: (mode: LeftMode) => void;
  showSettings: () => void;
  showToast: (text: string) => void;
  dismissToast: (id: string) => void;
  handleEnvelope: (envelope: WsEnvelope) => void;
}

type PermissionRequestView = PermissionRequest;
type JobKey = string;

const key = (artifactId: ArtifactId, versionId: VersionId) => `${artifactId}:${versionId}`;
const jobKey = (job: RemoteJob) => `${job.sessionId}:${job.jobId}`;

function mergeById<T>(items: T[], item: T, idKey: keyof T) {
  const exists = items.some((entry) => entry[idKey] === item[idKey]);
  return exists ? items.map((entry) => (entry[idKey] === item[idKey] ? item : entry)) : [item, ...items];
}

function textPart(message: Message) {
  return message.parts.find((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text");
}

export const useWorkspaceStore = create<AppState>((set, get) => ({
  loading: true,
  runtimeStatus: "booting",
  projects: [],
  sessionGroup: "active",
  sessions: [],
  messages: {},
  artifacts: {},
  versions: {},
  provenance: {},
  permissions: {},
  annotations: {},
  plans: {},
  tools: {},
  tracks: {},
  jobs: {},
  findings: {},
  connectors: [],
  skills: [],
  specialists: [],
  files: [],
  leftMode: "sessions",
  inspectorMode: "artifact",
  provenanceTab: "messages",
  pendingParts: [],
  eventLog: [],
  toasts: [],

  initialize: async () => {
    const unsubscribe = adapterClient.realtime.onEnvelope((envelope) => get().handleEnvelope(envelope));
    window.addEventListener("beforeunload", unsubscribe);

    const [currentProject, settings, connectors, skills, specialists, permissions] = await Promise.all([
      adapterClient.resources.currentProject(),
      adapterClient.resources.settings(),
      adapterClient.resources.connectors(),
      adapterClient.resources.skills(),
      adapterClient.resources.specialists(),
      adapterClient.resources.permissions(),
    ]);
    const [projects, sessions, files] = await Promise.all([
      adapterClient.resources.projects(),
      adapterClient.resources.sessions(currentProject.projectId, "active"),
      adapterClient.resources.filesTree(currentProject.projectId),
    ]);
    const activeSessionId = sessions[0]?.sessionId;
    set({
      projects,
      currentProject,
      settings,
      connectors,
      skills,
      specialists,
      permissions: Object.fromEntries(permissions.map((permission) => [permission.id, permission])),
      sessions,
      activeSessionId,
      files,
      loading: false,
    });
    adapterClient.realtime.connect(currentProject.projectId, get().lastEventId);
    if (activeSessionId) {
      await get().openSession(activeSessionId);
    }
  },

  selectProject: async (projectId) => {
    const currentProject = await adapterClient.resources.selectProject(projectId);
    const [sessions, files] = await Promise.all([
      adapterClient.resources.sessions(projectId, get().sessionGroup),
      adapterClient.resources.filesTree(projectId),
    ]);
    set({ currentProject, sessions, files, activeSessionId: sessions[0]?.sessionId, leftMode: "sessions" });
    adapterClient.realtime.connect(projectId, get().lastEventId);
    if (sessions[0]) await get().openSession(sessions[0].sessionId);
    await adapterClient.commands.projectSelect(projectId);
  },

  setSessionGroup: async (group) => {
    const projectId = get().currentProject?.projectId;
    if (!projectId) return;
    const sessions = await adapterClient.resources.sessions(projectId, group);
    set({ sessionGroup: group, sessions, activeSessionId: sessions[0]?.sessionId });
    if (sessions[0]) await get().openSession(sessions[0].sessionId);
  },

  openSession: async (sessionId) => {
    const projectId = get().currentProject?.projectId;
    if (!projectId) return;
    const [messages, artifacts, tracks] = await Promise.all([
      adapterClient.resources.messages(sessionId),
      adapterClient.resources.artifacts(projectId, sessionId),
      adapterClient.resources.tracks(sessionId),
    ]);
    const firstArtifact = artifacts[0];
    set((state) => ({
      activeSessionId: sessionId,
      messages: { ...state.messages, [sessionId]: messages },
      artifacts: { ...state.artifacts, [sessionId]: artifacts },
      tracks: { ...state.tracks, [sessionId]: tracks },
      activeArtifactId: firstArtifact?.id ?? state.activeArtifactId,
    }));
    await adapterClient.commands.sessionOpen(sessionId);
    if (firstArtifact) {
      await get().openArtifact(firstArtifact.id);
    }
  },

  createSession: async () => {
    const projectId = get().currentProject?.projectId;
    if (!projectId) return;
    await adapterClient.commands.sessionCreate(projectId);
  },

  stopSession: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await adapterClient.resources.stopSession(sessionId);
    await adapterClient.commands.sessionStop(sessionId);
  },

  renameSession: async (sessionId, title) => {
    const session = await adapterClient.resources.patchSession(sessionId, { title });
    set((state) => ({ sessions: state.sessions.map((item) => (item.sessionId === sessionId ? session : item)) }));
  },

  deleteSession: async (sessionId) => {
    await adapterClient.resources.deleteSession(sessionId);
    set((state) => ({ sessions: state.sessions.filter((session) => session.sessionId !== sessionId) }));
  },

  sendMessage: async (text) => {
    const sessionId = get().activeSessionId;
    if (!sessionId || (!text.trim() && get().pendingParts.length === 0)) return;
    const staged = Object.values(get().annotations).filter((annotation) => annotation.sessionId === sessionId && annotation.status === "staged");
    await adapterClient.commands.sessionSendMessage({
      sessionId,
      parts: [{ type: "text", text }, ...get().pendingParts],
      annotationIds: staged.map((annotation) => annotation.annotationId),
    });
    set({ pendingParts: [] });
  },

  addPendingPart: (part) => set((state) => ({ pendingParts: [...state.pendingParts, part] })),
  attachUpload: async (fileName) => {
    const upload = await adapterClient.resources.upload(fileName);
    set((state) => ({ pendingParts: [...state.pendingParts, { type: "upload_ref", uploadId: upload.uploadId, label: upload.name }] }));
  },
  clearPendingParts: () => set({ pendingParts: [] }),

  respondPermission: async (permissionId, decision, scope) => {
    await adapterClient.commands.permissionRespond(permissionId, decision, scope);
  },

  approvePlan: async (planId) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await adapterClient.commands.planApprove(planId, sessionId);
  },

  requestPlanRevision: async (planId) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await adapterClient.commands.planRequestRevision(planId, sessionId, "Tighten evidence and expose the citation mapping before running.");
  },

  openArtifact: async (artifactId, mode = "artifact") => {
    const artifact = await adapterClient.resources.artifact(artifactId);
    const versions = await adapterClient.resources.artifactVersions(artifactId);
    const versionId = artifact.currentVersionId;
    const provenance = await adapterClient.resources.provenance(artifactId, versionId);
    set((state) => ({
      activeArtifactId: artifactId,
      activeVersionId: versionId,
      inspectorMode: mode,
      versions: { ...state.versions, [artifactId]: versions },
      provenance: { ...state.provenance, [key(artifactId, versionId)]: provenance },
    }));
    await adapterClient.commands.artifactOpen(artifactId, versionId);
  },

  selectArtifactVersion: async (artifactId, versionId) => {
    const provenance = await adapterClient.resources.provenance(artifactId, versionId);
    set((state) => ({
      activeArtifactId: artifactId,
      activeVersionId: versionId,
      provenance: { ...state.provenance, [key(artifactId, versionId)]: provenance },
    }));
  },

  setProvenanceTab: (tab) => set({ provenanceTab: tab, inspectorMode: "provenance" }),

  starArtifact: async (artifactId, starred) => {
    await adapterClient.commands.artifactStar(artifactId, starred);
  },

  renameArtifact: async (artifactId, name) => {
    await adapterClient.commands.artifactRename(artifactId, name);
  },

  deleteArtifact: async (artifactId) => {
    await adapterClient.commands.artifactDelete(artifactId);
  },

  downloadArtifact: async (artifactId, versionId) => {
    const result = await adapterClient.resources.downloadUrl(artifactId, versionId);
    get().showToast(`Download URL ready: ${result.url}`);
    await adapterClient.commands.artifactDownloadUrl(artifactId, versionId);
  },

  stageAnnotation: async (target, note) => {
    const sessionId = get().activeSessionId;
    const artifactId = get().activeArtifactId;
    const versionId = get().activeVersionId;
    if (!sessionId || !artifactId || !versionId) return;
    await adapterClient.commands.annotationStage({ sessionId, artifactId, versionId, target, note });
  },

  discardAnnotation: async (annotationId) => {
    await adapterClient.commands.annotationDiscard(annotationId);
    set((state) => {
      const annotations = { ...state.annotations };
      delete annotations[annotationId];
      return { annotations };
    });
  },

  commitAnnotationsWithMessage: async (text) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    const annotationIds = Object.values(get().annotations)
      .filter((annotation) => annotation.sessionId === sessionId && annotation.status === "staged")
      .map((annotation) => annotation.annotationId);
    await adapterClient.commands.annotationCommitWithMessage({ sessionId, annotationIds, text });
  },

  runReviewer: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await adapterClient.commands.reviewerRun(sessionId, get().activeArtifactId, get().activeVersionId);
  },

  spawnTrack: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    await adapterClient.commands.trackSpawn(sessionId, "Evidence side track");
  },

  stopTrack: async (trackId) => {
    await adapterClient.commands.trackStop(trackId);
  },

  revokePermission: async (permissionId) => {
    await adapterClient.resources.revokePermission(permissionId);
    set((state) => ({
      permissions: {
        ...state.permissions,
        [permissionId]: { ...state.permissions[permissionId], status: "denied" },
      },
    }));
  },

  updateSettings: async (patch) => {
    const settings = await adapterClient.resources.patchSettings(patch);
    set({ settings });
    await adapterClient.commands.settingsUpdate(patch);
  },

  setLeftMode: (mode) => set({ leftMode: mode }),
  showSettings: () => set({ leftMode: "settings", inspectorMode: "settings" }),

  showToast: (text) => {
    const id = `toast_${Date.now()}`;
    set((state) => ({ toasts: [...state.toasts, { id, text }] }));
    window.setTimeout(() => get().dismissToast(id), 3600);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  handleEnvelope: (envelope) => {
    if (envelope.type === "ack") return;
    if (envelope.type === "error") {
      get().showToast(`${envelope.code}: ${envelope.message}`);
      return;
    }

    const event = envelope;
    set((state) => ({
      lastEventId: event.eventId,
      eventLog: [...state.eventLog.slice(-32), event],
    }));

    const name = event.name;
    const payload: any = event.payload;
    const sessionId = event.sessionId ?? payload?.sessionId;

    switch (name satisfies AdapterEventName) {
      case "session.created":
        set((state) => ({ sessions: mergeById(state.sessions, payload.session, "sessionId"), activeSessionId: payload.session.sessionId }));
        void get().openSession(payload.session.sessionId);
        break;
      case "session.updated":
        if (payload.session) set((state) => ({ sessions: mergeById(state.sessions, payload.session, "sessionId") }));
        break;
      case "session.statusChanged":
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.sessionId === payload.sessionId ? { ...session, status: payload.status } : session,
          ),
        }));
        break;
      case "message.created":
        set((state) => ({
          messages: {
            ...state.messages,
            [payload.message.sessionId]: [...(state.messages[payload.message.sessionId] ?? []), payload.message],
          },
        }));
        break;
      case "message.delta":
        set((state) => {
          const messages = [...(state.messages[sessionId] ?? [])];
          const index = messages.findIndex((message) => message.messageId === payload.messageId);
          if (index >= 0) {
            const part = textPart(messages[index]);
            messages[index] = {
              ...messages[index],
              parts: part
                ? messages[index].parts.map((entry) => (entry === part ? { ...part, text: part.text + payload.delta } : entry))
                : [...messages[index].parts, { type: "text", text: payload.delta }],
            };
          }
          return { messages: { ...state.messages, [sessionId]: messages } };
        });
        break;
      case "message.completed":
        set((state) => ({
          messages: {
            ...state.messages,
            [sessionId]: (state.messages[sessionId] ?? []).map((message) =>
              message.messageId === payload.messageId ? { ...message, status: "completed" } : message,
            ),
          },
        }));
        break;
      case "message.failed":
        get().showToast("Message failed in adapter stream");
        break;
      case "tool.started":
      case "tool.output":
      case "tool.completed":
      case "tool.failed":
        set((state) => ({ tools: { ...state.tools, [payload.tool.toolId]: payload.tool } }));
        break;
      case "permission.requested":
        set((state) => ({ permissions: { ...state.permissions, [payload.permission.id]: payload.permission } }));
        break;
      case "permission.resolved":
        set((state) => ({
          permissions: {
            ...state.permissions,
            [payload.permissionId]: {
              ...state.permissions[payload.permissionId],
              status: payload.decision === "approve" ? "approved" : "denied",
            },
          },
        }));
        break;
      case "plan.proposed":
        set((state) => ({ plans: { ...state.plans, [payload.plan.sessionId]: payload.plan } }));
        break;
      case "plan.approved":
      case "plan.updated":
        set((state) => ({
          plans: updatePlan(state.plans, payload.planId, { status: payload.status ?? "approved" }),
        }));
        break;
      case "plan.stepStarted":
        set((state) => ({ plans: updatePlanStep(state.plans, payload.planId, payload.stepId, "running") }));
        break;
      case "plan.stepCompleted":
        set((state) => ({ plans: updatePlanStep(state.plans, payload.planId, payload.stepId, "completed") }));
        break;
      case "plan.completed":
        set((state) => ({ plans: updatePlan(state.plans, payload.planId, { status: "completed" }) }));
        break;
      case "artifact.created":
      case "artifact.updated":
        if (payload.artifact) {
          set((state) => ({
            artifacts: {
              ...state.artifacts,
              [payload.artifact.sessionId]: mergeById(state.artifacts[payload.artifact.sessionId] ?? [], payload.artifact, "id"),
            },
          }));
        }
        if (payload.downloadUrl) get().showToast(`Adapter issued ${payload.downloadUrl}`);
        break;
      case "artifact.versionCreated":
        set((state) => ({
          versions: {
            ...state.versions,
            [payload.version.artifactId]: mergeById(state.versions[payload.version.artifactId] ?? [], payload.version, "versionId"),
          },
        }));
        break;
      case "artifact.deleted":
        set((state) => {
          const artifacts = Object.fromEntries(
            Object.entries(state.artifacts).map(([id, list]) => [id, list.filter((artifact) => artifact.id !== payload.artifactId)]),
          );
          return { artifacts, activeArtifactId: state.activeArtifactId === payload.artifactId ? undefined : state.activeArtifactId };
        });
        break;
      case "annotation.staged":
        set((state) => ({ annotations: { ...state.annotations, [payload.annotation.annotationId]: payload.annotation } }));
        break;
      case "annotation.committed":
        set((state) => {
          const annotations = { ...state.annotations };
          for (const id of payload.annotationIds ?? [payload.annotationId]) {
            if (annotations[id]) annotations[id] = { ...annotations[id], status: "committed" };
          }
          return { annotations };
        });
        break;
      case "review.started":
        get().showToast("Reviewer started");
        break;
      case "review.findings":
        set((state) => ({
          findings: { ...state.findings, ...Object.fromEntries(payload.findings.map((finding: ReviewerFinding) => [finding.findingId, finding])) },
        }));
        break;
      case "review.completed":
        get().showToast("Reviewer completed");
        break;
      case "track.created":
        set((state) => ({ tracks: { ...state.tracks, [payload.track.sessionId]: mergeById(state.tracks[payload.track.sessionId] ?? [], payload.track, "trackId") } }));
        break;
      case "track.message":
        set((state) => ({ tracks: appendTrackMessage(state.tracks, payload.trackId, payload.message) }));
        break;
      case "track.statusChanged":
        set((state) => ({ tracks: updateTrack(state.tracks, payload.trackId, payload) }));
        break;
      case "track.completed":
        set((state) => ({ tracks: updateTrack(state.tracks, payload.trackId, { status: "completed", progress: 100 }) }));
        break;
      case "runtime.statusChanged":
        set({ runtimeStatus: payload.status });
        break;
      case "remoteJob.statusChanged":
        set((state) => ({ jobs: { ...state.jobs, [jobKey(payload.job)]: payload.job } }));
        break;
      default:
        break;
    }
  },
}));

function updatePlan(plans: Record<SessionId, PlanState>, planId: string, patch: Partial<PlanState>) {
  return Object.fromEntries(
    Object.entries(plans).map(([sessionId, plan]) => [sessionId, plan.planId === planId ? { ...plan, ...patch } : plan]),
  );
}

function updatePlanStep(plans: Record<SessionId, PlanState>, planId: string, stepId: string, status: PlanState["steps"][number]["status"]) {
  return Object.fromEntries(
    Object.entries(plans).map(([sessionId, plan]) => [
      sessionId,
      plan.planId === planId
        ? { ...plan, steps: plan.steps.map((step) => (step.id === stepId ? { ...step, status } : step)) }
        : plan,
    ]),
  );
}

function updateTrack(tracks: Record<SessionId, Track[]>, trackId: string, patch: Partial<Track>) {
  return Object.fromEntries(
    Object.entries(tracks).map(([sessionId, list]) => [
      sessionId,
      list.map((track) => (track.trackId === trackId ? { ...track, ...patch } : track)),
    ]),
  );
}

function appendTrackMessage(tracks: Record<SessionId, Track[]>, trackId: string, message: string) {
  return Object.fromEntries(
    Object.entries(tracks).map(([sessionId, list]) => [
      sessionId,
      list.map((track) => (track.trackId === trackId ? { ...track, messages: [...track.messages, message] } : track)),
    ]),
  );
}
