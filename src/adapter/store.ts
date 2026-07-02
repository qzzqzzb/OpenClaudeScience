import { nanoid } from "nanoid";
import type { AdapterEventName, AdapterMessage, ArtifactKind, EventEnvelope, ExecutionLogRecord, PermissionScope, PermissionType } from "./contract.js";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  selected: boolean;
};

export type SessionRecord = {
  id: string;
  projectId: string;
  title?: string;
  status: "idle" | "running" | "reviewing" | "stopped" | "error";
  createdAt: string;
  updatedAt: string;
};

export type ArtifactRecord = {
  id: string;
  projectId: string;
  sessionId?: string;
  kind: ArtifactKind;
  name: string;
  currentVersionId: string;
  mimeType?: string;
  starred: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactVersionRecord = {
  id: string;
  artifactId: string;
  version: number;
  createdAt: string;
  sourceMessageIds: string[];
  provenance: ArtifactVersionProvenanceRecord;
  path: string;
  size: number;
  sha256: string;
  mimeType?: string;
};

export type ArtifactVersionProvenanceRecord = {
  executionStepIds: string[];
  code: ProvenanceCodeRecord[];
  environment: Record<string, unknown>;
  review: ProvenanceReviewRecord[];
};

export type ProvenanceCodeRecord = {
  language: string;
  content?: string;
  description?: string;
};

export type ProvenanceReviewRecord =
  | {
      type: "finding";
    findingId: string;
    severity: string;
    claim?: string;
    evidence?: string;
    transcriptUrl?: string;
    provenanceUrl?: string;
  }
  | {
      type: "summary";
      summary: string;
    }
  | {
      type: "not_run";
      reason?: string;
    };

export type PermissionRecord = {
  id: string;
  sessionId?: string;
  type: PermissionType;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  scopes: PermissionScope[];
  recommendedScope: PermissionScope;
  risk: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied" | "revoked";
  grantedScope?: PermissionScope;
  appliedGrantId?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PermissionGrantRecord = {
  id: string;
  permissionId: string;
  projectId: string;
  sessionId?: string;
  type: PermissionType;
  signature: string;
  scope: PermissionScope;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type RuntimePermissionMapping = {
  runtimeSessionId?: string;
  runtimePermissionId?: string;
};

export type PlanStatus = "proposed" | "awaiting_approval" | "approved" | "running" | "completed" | "revision_requested";

export type PlanRecord = {
  id: string;
  sessionId: string;
  version: number;
  title?: string;
  summary?: string;
  status: PlanStatus;
  supersedesPlanId?: string;
  revisionRequest?: string;
  steps: PlanStepRecord[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  completedAt?: string;
};

export type PlanStepRecord = {
  id: string;
  planId: string;
  index: number;
  title: string;
  description?: string;
  status: "pending" | "running" | "completed";
  executionStepIds: string[];
  startedAt?: string;
  completedAt?: string;
};

export type AnnotationStatus = "staged" | "committed" | "discarded";

export type AnnotationRecord = {
  id: string;
  sessionId: string;
  artifactId: string;
  versionId?: string;
  body: string;
  anchor: Record<string, unknown>;
  status: AnnotationStatus;
  messageId?: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  discardedAt?: string;
};

export type ReviewRunRecord = {
  id: string;
  sessionId: string;
  artifactId?: string;
  versionId?: string;
  mode: "manual" | "automatic";
  status: "running" | "completed" | "failed";
  findings: ReviewFindingRecord[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type ReviewFindingRecord = {
  id: string;
  reviewId: string;
  severity: "info" | "warning" | "error";
  claim: string;
  evidence: string;
  transcriptUrl?: string;
  provenanceUrl?: string;
  createdAt: string;
};

export type TrackStatus = "running" | "blocked" | "completed" | "failed" | "cancelled";

export type TrackRecord = {
  id: string;
  sessionId: string;
  parentTrackId?: string;
  title: string;
  agentKind?: string;
  transcriptUrl?: string;
  status: TrackStatus;
  message?: string;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
};

export type RemoteJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RemoteJobLogRecord = {
  id: string;
  jobId: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
  createdAt: string;
};

export type RemoteJobRecord = {
  id: string;
  sessionId: string;
  trackId?: string;
  provider: string;
  title: string;
  command?: string;
  externalUrl?: string;
  status: RemoteJobStatus;
  error?: string;
  artifactIds: string[];
  metadata: Record<string, unknown>;
  logs: RemoteJobLogRecord[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
};

export class AdapterStore {
  readonly project: ProjectRecord;

  private seq = 0;
  private readonly events: EventEnvelope[] = [];
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly runtimeSessionIds = new Map<string, string>();
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly artifactVersions = new Map<string, ArtifactVersionRecord[]>();
  private readonly executionLogs = new Map<string, ExecutionLogRecord>();
  private readonly messages = new Map<string, AdapterMessage>();
  private readonly messageSessions = new Map<string, string>();
  private readonly permissions = new Map<string, PermissionRecord>();
  private readonly permissionGrants = new Map<string, PermissionGrantRecord>();
  private readonly runtimePermissionMappings = new Map<string, RuntimePermissionMapping>();
  private readonly plans = new Map<string, PlanRecord>();
  private readonly annotations = new Map<string, AnnotationRecord>();
  private readonly reviews = new Map<string, ReviewRunRecord>();
  private readonly tracks = new Map<string, TrackRecord>();
  private readonly remoteJobs = new Map<string, RemoteJobRecord>();

  constructor(projectRoot: string) {
    this.project = {
      id: "proj_local",
      name: "OpenClaudeScience",
      path: projectRoot,
      selected: true,
    };
  }

  listSessions(group: "active" | "today" | "all" = "all"): SessionRecord[] {
    const sessions = [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (group === "active") return sessions.filter((session) => ["running", "reviewing"].includes(session.status));
    if (group === "today") {
      const today = new Date().toISOString().slice(0, 10);
      return sessions.filter((session) => session.updatedAt.startsWith(today));
    }
    return sessions;
  }

  getSession(id: string): SessionRecord | undefined {
    return this.sessions.get(id);
  }

  createSession(input: { title?: string; runtimeSessionId?: string }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: `ses_${nanoid(12)}`,
      projectId: this.project.id,
      title: input.title,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    if (input.runtimeSessionId) this.runtimeSessionIds.set(session.id, input.runtimeSessionId);
    return session;
  }

  addMessage(message: AdapterMessage): AdapterMessage {
    this.messages.set(message.id, message);
    this.messageSessions.set(message.id, message.sessionId);
    return message;
  }

  listMessages(sessionId: string): AdapterMessage[] {
    return [...this.messages.values()]
      .filter((message) => message.sessionId === sessionId)
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  }

  createPlan(input: {
    sessionId: string;
    title?: string;
    summary?: string;
    steps: Array<{ title: string; description?: string; executionStepIds?: string[] }>;
    supersedesPlanId?: string;
    revisionRequest?: string;
  }): PlanRecord {
    const now = new Date().toISOString();
    const previousVersion = input.supersedesPlanId ? (this.plans.get(input.supersedesPlanId)?.version ?? 0) : 0;
    const planId = `plan_${nanoid(12)}`;
    const plan: PlanRecord = {
      id: planId,
      sessionId: input.sessionId,
      version: previousVersion + 1,
      title: input.title,
      summary: input.summary,
      status: "awaiting_approval",
      supersedesPlanId: input.supersedesPlanId,
      revisionRequest: input.revisionRequest,
      steps: input.steps.map((step, index) => ({
        id: `pstep_${nanoid(12)}`,
        planId,
        index,
        title: step.title,
        description: step.description,
        status: "pending",
        executionStepIds: step.executionStepIds ?? [],
      })),
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  getPlan(planId: string): PlanRecord | undefined {
    return this.plans.get(planId);
  }

  listPlans(sessionId: string): PlanRecord[] {
    return [...this.plans.values()].filter((plan) => plan.sessionId === sessionId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  updatePlan(planId: string, patch: Partial<Omit<PlanRecord, "id" | "sessionId" | "createdAt" | "steps">> & { steps?: PlanStepRecord[] }): PlanRecord {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    const updated = { ...plan, ...patch, updatedAt: new Date().toISOString() };
    this.plans.set(planId, updated);
    return updated;
  }

  createAnnotation(input: {
    sessionId: string;
    artifactId: string;
    versionId?: string;
    body: string;
    anchor: Record<string, unknown>;
  }): AnnotationRecord {
    const now = new Date().toISOString();
    const annotation: AnnotationRecord = {
      id: `ann_${nanoid(12)}`,
      sessionId: input.sessionId,
      artifactId: input.artifactId,
      versionId: input.versionId,
      body: input.body,
      anchor: input.anchor,
      status: "staged",
      createdAt: now,
      updatedAt: now,
    };
    this.annotations.set(annotation.id, annotation);
    return annotation;
  }

  getAnnotation(annotationId: string): AnnotationRecord | undefined {
    return this.annotations.get(annotationId);
  }

  listAnnotations(sessionId?: string): AnnotationRecord[] {
    return [...this.annotations.values()]
      .filter((annotation) => !sessionId || annotation.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listStagedAnnotations(sessionId: string): AnnotationRecord[] {
    return this.listAnnotations(sessionId).filter((annotation) => annotation.status === "staged");
  }

  discardAnnotations(annotationIds: string[]): AnnotationRecord[] {
    const now = new Date().toISOString();
    const annotations = this.validateAnnotationsForDiscard(annotationIds);
    return annotations.map((annotation) => {
      const updated = { ...annotation, status: "discarded" as const, discardedAt: now, updatedAt: now };
      this.annotations.set(annotation.id, updated);
      return updated;
    });
  }

  validateAnnotationsForDiscard(annotationIds: string[]): AnnotationRecord[] {
    const uniqueIds = uniqueAnnotationIds(annotationIds);
    return uniqueIds.map((annotationId) => {
      const annotation = this.annotations.get(annotationId);
      if (!annotation) throw new Error(`Annotation not found: ${annotationId}`);
      if (annotation.status !== "staged") throw new Error("Only staged annotations can be discarded");
      return annotation;
    });
  }

  commitAnnotations(annotationIds: string[], sessionId: string, messageId: string): AnnotationRecord[] {
    const now = new Date().toISOString();
    const annotations = this.validateAnnotationsForCommit(annotationIds, sessionId);
    return annotations.map((annotation) => {
      const updated = { ...annotation, status: "committed" as const, messageId, committedAt: now, updatedAt: now };
      this.annotations.set(annotation.id, updated);
      return updated;
    });
  }

  createReview(input: {
    sessionId: string;
    artifactId?: string;
    versionId?: string;
    mode?: "manual" | "automatic";
  }): ReviewRunRecord {
    const now = new Date().toISOString();
    const review: ReviewRunRecord = {
      id: `rev_${nanoid(12)}`,
      sessionId: input.sessionId,
      artifactId: input.artifactId,
      versionId: input.versionId,
      mode: input.mode ?? "manual",
      status: "running",
      findings: [],
      createdAt: now,
      updatedAt: now,
    };
    this.reviews.set(review.id, review);
    return review;
  }

  completeReview(reviewId: string, findingsInput: Array<Omit<ReviewFindingRecord, "id" | "reviewId" | "createdAt">>): ReviewRunRecord {
    const review = this.reviews.get(reviewId);
    if (!review) throw new Error(`Review not found: ${reviewId}`);
    const now = new Date().toISOString();
    const findings = findingsInput.map((finding) => ({
      id: `finding_${nanoid(12)}`,
      reviewId,
      severity: finding.severity,
      claim: finding.claim,
      evidence: finding.evidence,
      transcriptUrl: finding.transcriptUrl,
      provenanceUrl: finding.provenanceUrl,
      createdAt: now,
    }));
    const updated = { ...review, status: "completed" as const, findings, completedAt: now, updatedAt: now };
    this.reviews.set(review.id, updated);
    if (updated.artifactId && updated.versionId) this.attachReviewToArtifactVersion(updated.artifactId, updated.versionId, findings);
    return updated;
  }

  failReview(reviewId: string, error: string): ReviewRunRecord {
    const review = this.reviews.get(reviewId);
    if (!review) throw new Error(`Review not found: ${reviewId}`);
    const now = new Date().toISOString();
    const updated = { ...review, status: "failed" as const, error, completedAt: now, updatedAt: now };
    this.reviews.set(review.id, updated);
    return updated;
  }

  listReviews(sessionId?: string): ReviewRunRecord[] {
    return [...this.reviews.values()]
      .filter((review) => !sessionId || review.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  createTrack(input: {
    sessionId: string;
    title: string;
    parentTrackId?: string;
    agentKind?: string;
    transcriptUrl?: string;
    metadata?: Record<string, unknown>;
  }): TrackRecord {
    const now = new Date().toISOString();
    const track: TrackRecord = {
      id: `track_${nanoid(12)}`,
      sessionId: input.sessionId,
      parentTrackId: input.parentTrackId,
      title: input.title,
      agentKind: input.agentKind,
      transcriptUrl: input.transcriptUrl,
      status: "running",
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.tracks.set(track.id, track);
    return track;
  }

  getTrack(trackId: string): TrackRecord | undefined {
    return this.tracks.get(trackId);
  }

  listTracks(sessionId?: string): TrackRecord[] {
    return [...this.tracks.values()]
      .filter((track) => !sessionId || track.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  updateTrack(
    trackId: string,
    patch: Partial<Pick<TrackRecord, "status" | "message" | "transcriptUrl" | "error">>,
  ): TrackRecord {
    const existing = this.tracks.get(trackId);
    if (!existing) throw new Error(`Track not found: ${trackId}`);
    if (["completed", "failed", "cancelled"].includes(existing.status)) throw new Error("Terminal tracks cannot be updated");
    const now = new Date().toISOString();
    const status = patch.status ?? existing.status;
    const terminalAt = ["completed", "failed"].includes(status) ? now : undefined;
    const cancelledAt = status === "cancelled" ? now : undefined;
    const updated = {
      ...existing,
      ...patch,
      status,
      updatedAt: now,
      completedAt: terminalAt ?? existing.completedAt,
      cancelledAt: cancelledAt ?? existing.cancelledAt,
    };
    this.tracks.set(trackId, updated);
    return updated;
  }

  stopTrack(trackId: string, reason?: string): TrackRecord {
    return this.updateTrack(trackId, { status: "cancelled", message: reason ?? "Stopped" });
  }

  createRemoteJob(input: {
    sessionId: string;
    trackId?: string;
    provider: string;
    title: string;
    command?: string;
    externalUrl?: string;
    metadata?: Record<string, unknown>;
  }): RemoteJobRecord {
    const now = new Date().toISOString();
    const job: RemoteJobRecord = {
      id: `rjob_${nanoid(12)}`,
      sessionId: input.sessionId,
      trackId: input.trackId,
      provider: input.provider,
      title: input.title,
      command: input.command,
      externalUrl: input.externalUrl,
      status: "queued",
      artifactIds: [],
      metadata: input.metadata ?? {},
      logs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.remoteJobs.set(job.id, job);
    return job;
  }

  getRemoteJob(jobId: string): RemoteJobRecord | undefined {
    return this.remoteJobs.get(jobId);
  }

  listRemoteJobs(sessionId?: string): RemoteJobRecord[] {
    return [...this.remoteJobs.values()]
      .filter((job) => !sessionId || job.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  updateRemoteJob(
    jobId: string,
    patch: Pick<RemoteJobRecord, "status"> & Partial<Pick<RemoteJobRecord, "externalUrl" | "error" | "artifactIds">>,
  ): RemoteJobRecord {
    const existing = this.remoteJobs.get(jobId);
    if (!existing) throw new Error(`Remote job not found: ${jobId}`);
    if (["succeeded", "failed", "cancelled"].includes(existing.status)) throw new Error("Terminal remote jobs cannot be updated");
    const now = new Date().toISOString();
    const completedAt = ["succeeded", "failed"].includes(patch.status) ? now : existing.completedAt;
    const cancelledAt = patch.status === "cancelled" ? now : existing.cancelledAt;
    const updated = {
      ...existing,
      ...patch,
      artifactIds: patch.artifactIds ?? existing.artifactIds,
      updatedAt: now,
      completedAt,
      cancelledAt,
    };
    this.remoteJobs.set(jobId, updated);
    return updated;
  }

  appendRemoteJobLog(jobId: string, input: { stream: "stdout" | "stderr" | "system"; text: string }): { job: RemoteJobRecord; log: RemoteJobLogRecord } {
    const existing = this.remoteJobs.get(jobId);
    if (!existing) throw new Error(`Remote job not found: ${jobId}`);
    if (["succeeded", "failed", "cancelled"].includes(existing.status)) throw new Error("Terminal remote jobs cannot receive new logs");
    const now = new Date().toISOString();
    const log: RemoteJobLogRecord = {
      id: `rjlog_${nanoid(12)}`,
      jobId,
      stream: input.stream,
      text: input.text,
      createdAt: now,
    };
    const updated = { ...existing, logs: [...existing.logs, log], updatedAt: now };
    this.remoteJobs.set(jobId, updated);
    return { job: updated, log };
  }

  stopSessionWork(sessionId: string): { tracks: TrackRecord[]; remoteJobs: RemoteJobRecord[] } {
    const tracks = this.listTracks(sessionId)
      .filter((track) => track.status === "running" || track.status === "blocked")
      .map((track) => this.stopTrack(track.id, "Session stopped"));
    const remoteJobs = this.listRemoteJobs(sessionId)
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => this.updateRemoteJob(job.id, { status: "cancelled", error: "Session stopped" }));
    return { tracks, remoteJobs };
  }

  private attachReviewToArtifactVersion(artifactId: string, versionId: string, findings: ReviewFindingRecord[]): void {
    const versions = this.artifactVersions.get(artifactId);
    if (!versions) return;
    const updatedVersions = versions.map((version) =>
      version.id === versionId
        ? {
            ...version,
            provenance: {
              ...version.provenance,
              review: [
                ...version.provenance.review.filter((entry) => entry.type !== "not_run"),
                ...findings.map((finding) => ({
                  type: "finding" as const,
                  findingId: finding.id,
                  severity: finding.severity,
                  claim: finding.claim,
                  evidence: finding.evidence,
                  transcriptUrl: finding.transcriptUrl,
                  provenanceUrl: finding.provenanceUrl,
                })),
              ],
            },
          }
        : version,
    );
    this.artifactVersions.set(artifactId, updatedVersions);
  }

  validateAnnotationsForCommit(annotationIds: string[], sessionId: string): AnnotationRecord[] {
    const uniqueIds = uniqueAnnotationIds(annotationIds);
    return uniqueIds.map((annotationId) => {
      const annotation = this.annotations.get(annotationId);
      if (!annotation) throw new Error(`Annotation not found: ${annotationId}`);
      if (annotation.sessionId !== sessionId) throw new Error("Annotation is not in this session");
      if (annotation.status !== "staged") throw new Error("Only staged annotations can be committed");
      return annotation;
    });
  }

  getRuntimeSessionId(sessionId: string): string | undefined {
    return this.runtimeSessionIds.get(sessionId);
  }

  getSessionIdByRuntimeSessionId(runtimeSessionId: string): string | undefined {
    for (const [sessionId, mappedRuntimeSessionId] of this.runtimeSessionIds) {
      if (mappedRuntimeSessionId === runtimeSessionId) return sessionId;
    }
    return undefined;
  }

  updateSession(id: string, patch: Partial<Omit<SessionRecord, "id" | "projectId" | "createdAt">>): SessionRecord {
    const session = this.mustGetSession(id);
    const updated = { ...session, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(id, updated);
    return updated;
  }

  deleteSession(id: string): boolean {
    this.runtimeSessionIds.delete(id);
    return this.sessions.delete(id);
  }

  listArtifacts(sessionId?: string): ArtifactRecord[] {
    return [...this.artifacts.values()].filter((artifact) => !artifact.deleted && (!sessionId || artifact.sessionId === sessionId));
  }

  getArtifact(id: string): ArtifactRecord | undefined {
    return this.artifacts.get(id);
  }

  updateArtifact(id: string, patch: Partial<Pick<ArtifactRecord, "name" | "starred" | "deleted">>): ArtifactRecord {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    const updated = { ...artifact, ...patch, updatedAt: new Date().toISOString() };
    this.artifacts.set(id, updated);
    return updated;
  }

  listArtifactVersions(artifactId: string): ArtifactVersionRecord[] {
    return this.artifactVersions.get(artifactId) ?? [];
  }

  createOrVersionArtifact(input: {
    sessionId?: string;
    kind: ArtifactKind;
    name: string;
    mimeType?: string;
    path: string;
    size: number;
    sha256: string;
    sourceMessageIds?: string[];
    provenance?: Partial<ArtifactVersionProvenanceRecord>;
  }): { artifact: ArtifactRecord; version: ArtifactVersionRecord; created: boolean } {
    const now = new Date().toISOString();
    const existing = [...this.artifacts.values()].find(
      (artifact) =>
        !artifact.deleted &&
        artifact.projectId === this.project.id &&
        artifact.sessionId === input.sessionId &&
        artifact.name === input.name,
    );
    const artifact =
      existing ??
      ({
        id: `art_${nanoid(12)}`,
        projectId: this.project.id,
        sessionId: input.sessionId,
        kind: input.kind,
        name: input.name,
        currentVersionId: "",
        mimeType: input.mimeType,
        starred: false,
        deleted: false,
        createdAt: now,
        updatedAt: now,
      } satisfies ArtifactRecord);
    const versions = this.artifactVersions.get(artifact.id) ?? [];
    const version: ArtifactVersionRecord = {
      id: `ver_${nanoid(12)}`,
      artifactId: artifact.id,
      version: versions.length + 1,
      createdAt: now,
      sourceMessageIds: input.sourceMessageIds ?? [],
      provenance: {
        executionStepIds: input.provenance?.executionStepIds ?? [],
        code: input.provenance?.code ?? [],
        environment: input.provenance?.environment ?? {},
        review: input.provenance?.review ?? [],
      },
      path: input.path,
      size: input.size,
      sha256: input.sha256,
      mimeType: input.mimeType,
    };
    const updatedArtifact = {
      ...artifact,
      kind: input.kind,
      mimeType: input.mimeType ?? artifact.mimeType,
      currentVersionId: version.id,
      updatedAt: now,
    };
    this.artifacts.set(updatedArtifact.id, updatedArtifact);
    this.artifactVersions.set(updatedArtifact.id, [...versions, version]);
    return { artifact: updatedArtifact, version, created: !existing };
  }

  listExecutionLogs(stepIds: string[]): ExecutionLogRecord[] {
    return stepIds.map((stepId) => this.executionLogs.get(stepId)).filter((record): record is ExecutionLogRecord => Boolean(record));
  }

  getExecutionLog(stepId: string): ExecutionLogRecord | undefined {
    return this.executionLogs.get(stepId);
  }

  hasMessage(sessionId: string, messageId: string): boolean {
    return this.messageSessions.get(messageId) === sessionId;
  }

  listPermissions(): PermissionRecord[] {
    return [...this.permissions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listPermissionGrants(): PermissionGrantRecord[] {
    return [...this.permissionGrants.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  updatePermission(id: string, patch: Partial<Omit<PermissionRecord, "id" | "createdAt">>): PermissionRecord {
    const permission = this.permissions.get(id);
    if (!permission) throw new Error(`Permission not found: ${id}`);
    const updated = { ...permission, ...patch, updatedAt: new Date().toISOString() };
    this.permissions.set(id, updated);
    return updated;
  }

  createPermission(input: {
    sessionId?: string;
    type: PermissionType;
    title: string;
    summary: string;
    details?: Record<string, unknown>;
    runtime?: RuntimePermissionMapping;
    scopes?: PermissionScope[];
    recommendedScope?: PermissionScope;
    risk?: "low" | "medium" | "high";
  }): PermissionRecord {
    const now = new Date().toISOString();
    const permission: PermissionRecord = {
      id: `perm_${nanoid(12)}`,
      sessionId: input.sessionId,
      type: input.type,
      title: input.title,
      summary: input.summary,
      details: input.details ?? {},
      scopes: input.scopes ?? ["once", "conversation", "project", "global"],
      recommendedScope: input.recommendedScope ?? "once",
      risk: input.risk ?? "medium",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.permissions.set(permission.id, permission);
    if (input.runtime) this.runtimePermissionMappings.set(permission.id, input.runtime);
    return permission;
  }

  revokePermission(id: string): PermissionRecord {
    const revokedAt = new Date().toISOString();
    const permission = this.permissions.get(id);
    for (const grant of this.permissionGrants.values()) {
      if (grant.status === "active" && (grant.permissionId === id || grant.id === permission?.appliedGrantId)) {
        this.permissionGrants.set(grant.id, { ...grant, status: "revoked", revokedAt, updatedAt: revokedAt });
      }
    }
    return this.updatePermission(id, { status: "revoked", revokedAt });
  }

  getRuntimePermissionMapping(permissionId: string): RuntimePermissionMapping | undefined {
    return this.runtimePermissionMappings.get(permissionId);
  }

  createPermissionGrant(permission: PermissionRecord, scope: PermissionScope): PermissionGrantRecord {
    const now = new Date().toISOString();
    const grant: PermissionGrantRecord = {
      id: `pgrant_${nanoid(12)}`,
      permissionId: permission.id,
      projectId: this.project.id,
      sessionId: scope === "conversation" ? permission.sessionId : undefined,
      type: permission.type,
      signature: permissionSignature(permission),
      scope,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.permissionGrants.set(grant.id, grant);
    return grant;
  }

  findActivePermissionGrant(input: {
    sessionId?: string;
    type: PermissionType;
    title: string;
    details: Record<string, unknown>;
  }): PermissionGrantRecord | undefined {
    const signature = permissionSignature(input);
    return [...this.permissionGrants.values()].find((grant) => {
      if (grant.status !== "active") return false;
      if (grant.type !== input.type) return false;
      if (grant.signature !== signature) return false;
      if (grant.scope === "once") return false;
      if (grant.scope === "conversation") return grant.sessionId === input.sessionId;
      return grant.scope === "project" || grant.scope === "global";
    });
  }

  appendEvent(name: AdapterEventName, payload: unknown, sessionId?: string): EventEnvelope {
    const event: EventEnvelope = {
      type: "event",
      eventId: `evt_${nanoid(12)}`,
      seq: ++this.seq,
      sessionId,
      name,
      payload,
    };
    this.events.push(event);
    this.indexMessage(event);
    this.indexExecutionLog(event);
    return event;
  }

  eventsAfter(lastEventId?: string): EventEnvelope[] {
    if (!lastEventId) return [];
    const index = this.events.findIndex((event) => event.eventId === lastEventId);
    if (index === -1) return [];
    return this.events.slice(index + 1);
  }

  hasEvent(eventId: string): boolean {
    return this.events.some((event) => event.eventId === eventId);
  }

  private mustGetSession(id: string): SessionRecord {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    return session;
  }

  private indexExecutionLog(event: EventEnvelope): void {
    if (!["tool.started", "tool.output", "tool.completed", "tool.failed"].includes(event.name)) return;
    const payload = asRecord(event.payload);
    const stepId = typeof payload.toolStepId === "string" ? payload.toolStepId : undefined;
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : event.sessionId;
    if (!stepId || !sessionId) return;
    const now = new Date().toISOString();
    const existing = this.executionLogs.get(stepId);
    const status = event.name === "tool.failed" ? "failed" : event.name === "tool.completed" ? "completed" : "running";
    const updated: ExecutionLogRecord = {
      stepId,
      sessionId,
      kind: normalizeToolKind(typeof payload.tool === "string" ? payload.tool : "tool"),
      tool: typeof payload.tool === "string" ? payload.tool : "tool",
      title: typeof payload.title === "string" ? payload.title : existing?.title,
      input: isRecord(payload.input) ? payload.input : existing?.input,
      stdout: typeof payload.stdout === "string" ? payload.stdout : typeof payload.output === "string" ? payload.output : existing?.stdout,
      stderr: typeof payload.stderr === "string" ? payload.stderr : existing?.stderr,
      exitCode: typeof payload.exitCode === "number" ? payload.exitCode : existing?.exitCode,
      status,
      error: isRecord(payload.error) && typeof payload.error.code === "string" && typeof payload.error.message === "string" ? { code: payload.error.code, message: payload.error.message } : existing?.error,
      startedAt: existing?.startedAt ?? now,
      completedAt: status === "completed" || status === "failed" ? now : existing?.completedAt,
    };
    this.executionLogs.set(stepId, updated);
  }

  private indexMessage(event: EventEnvelope): void {
    const payload = asRecord(event.payload);
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : event.sessionId;
    if (!sessionId) return;
    if (event.name === "message.created") {
      const messageId = typeof payload.messageId === "string" ? payload.messageId : undefined;
      if (messageId) this.messageSessions.set(messageId, sessionId);
      return;
    }
    if (event.name === "message.delta") {
      const messageId = typeof payload.messageId === "string" ? payload.messageId : undefined;
      if (messageId) this.messageSessions.set(messageId, sessionId);
      return;
    }
    if (event.name === "message.completed" || event.name === "message.failed") {
      const message = asRecord(payload.message);
      const messageId = typeof message.id === "string" ? message.id : undefined;
      if (messageId) this.messageSessions.set(messageId, sessionId);
    }
  }
}

function permissionSignature(input: { type: PermissionType; title: string; details: Record<string, unknown> }): string {
  return JSON.stringify({
    type: input.type,
    title: input.title,
    details: Object.fromEntries(Object.entries(input.details).sort(([left], [right]) => left.localeCompare(right))),
  });
}

function normalizeToolKind(tool: string): string {
  const normalized = tool.toLowerCase();
  if (normalized.includes("python")) return "python";
  if (normalized.includes("bash") || normalized.includes("shell")) return "shell";
  if (normalized === "r" || normalized === "rscript") return "r";
  return normalized || "tool";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function uniqueAnnotationIds(annotationIds: string[]): string[] {
  const uniqueIds = [...new Set(annotationIds)];
  if (uniqueIds.length !== annotationIds.length) throw new Error("Duplicate annotation IDs are not allowed");
  return uniqueIds;
}
