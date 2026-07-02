import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { adapterConfig, opencodeBaseUrl } from "./config.js";
import type { AdapterEventName, AdapterMessage, AdapterMessagePart, ArtifactKind, ClientCommandEnvelope, EventEnvelope, ExecutionLogRecord, MessagePart, PermissionType, ServerEnvelope } from "./contract.js";
import { AdapterCommandNotImplementedError, toAdapterError } from "./errors.js";
import { OpenCodeRuntimeManager } from "./runtime/manager.js";
import { OpenCodeRuntime } from "./runtime/opencode.js";
import { normalizeRuntimeEvent, normalizeRuntimeMessage, normalizeRuntimeMessages } from "./runtime/normalize.js";
import type { NormalizedRuntimeEvent } from "./runtime/normalize.js";
import {
  annotationCommitWithMessagePayloadSchema,
  annotationDiscardPayloadSchema,
  annotationStagePayloadSchema,
  artifactIdPayloadSchema,
  artifactDownloadUrlPayloadSchema,
  artifactOpenPayloadSchema,
  artifactPatchPayloadSchema,
  artifactRegisterPayloadSchema,
  artifactRenamePayloadSchema,
  artifactStarPayloadSchema,
  clientCommandSchema,
  createSessionPayloadSchema,
  permissionRevokePayloadSchema,
  permissionResponsePayloadSchema,
  planApprovePayloadSchema,
  planProposePayloadSchema,
  planRecordStepResultPayloadSchema,
  planRequestRevisionPayloadSchema,
  reviewerRunPayloadSchema,
  remoteJobAppendLogPayloadSchema,
  remoteJobSubmitPayloadSchema,
  remoteJobUpdatePayloadSchema,
  sessionOpenPayloadSchema,
  sendMessagePayloadSchema,
  stopSessionPayloadSchema,
  trackSpawnPayloadSchema,
  trackStopPayloadSchema,
  trackUpdatePayloadSchema,
} from "./schemas.js";
import { AdapterStore } from "./store.js";
import type { ArtifactRecord, ArtifactVersionRecord, SessionRecord } from "./store.js";
import { WsHub } from "./wsHub.js";

const store = new AdapterStore(adapterConfig.projectRoot);
const artifactBlobRoot = path.join(adapterConfig.storageRoot, "artifacts");
const runtime = new OpenCodeRuntime({
  baseUrl: opencodeBaseUrl(),
  projectRoot: adapterConfig.projectRoot,
  sdkVersion: adapterConfig.opencode.sdkVersion,
});
const hub = new WsHub();

const app = Fastify({
  logger: true,
});

const runtimeManager = new OpenCodeRuntimeManager({
  mode: adapterConfig.runtimeMode,
  command: adapterConfig.opencode.command,
  host: adapterConfig.opencode.host,
  port: adapterConfig.opencode.port,
  corsOrigin: `http://${adapterConfig.host}:${adapterConfig.port}`,
  projectRoot: adapterConfig.projectRoot,
  runtime,
  logger: app.log,
});
let runtimeEventsController: AbortController | undefined;

await app.register(websocket);

app.addHook("onRequest", async (request, reply) => {
  const allowedOrigin = getAllowedCorsOrigin(request.headers.origin);
  if (allowedOrigin) {
    reply.header("Access-Control-Allow-Origin", allowedOrigin);
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID");
  }
  if (request.method === "OPTIONS") {
    return reply.code(204).send();
  }
});

app.get("/v1/health", async () => {
  const runtimeHealth = await runtime.health();
  return {
    healthy: true,
    adapter: {
      version: "0.1.0",
      projectRoot: adapterConfig.projectRoot,
    },
    runtime: {
      kind: "opencode",
      sdkVersion: adapterConfig.opencode.sdkVersion,
      mode: adapterConfig.runtimeMode,
      manager: runtimeManager.getState().managedProcess,
      ...runtimeHealth,
    },
  };
});

app.get("/v1/projects", async () => {
  return [store.project];
});

app.get("/v1/projects/current", async () => {
  return store.project;
});

app.post("/v1/projects/select", async () => {
  return store.project;
});

app.get("/v1/sessions", async (request) => {
  const query = request.query as { group?: "active" | "today" | "all" };
  return {
    sessions: store.listSessions(query.group ?? "all"),
    runtime: await runtime.health(),
  };
});

app.post("/v1/sessions", async (request, reply) => {
  try {
    const payload = createSessionPayloadSchema.parse(request.body ?? {});
    const runtimeSession = await runtime.createSession({
      title: payload.title,
      parentId: payload.parentId,
    });
    const session = store.createSession({
      title: payload.title,
      runtimeSessionId: runtimeSession.id,
    });
    publish("session.created", { session }, session.id);
    return { session };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/sessions/:sessionId", async (request, reply) => {
  const params = request.params as { sessionId: string };
  const session = store.getSession(params.sessionId);
  if (!session) return reply.code(404).send({ code: "NOT_FOUND", message: "Session not found" });
  return { session };
});

app.patch("/v1/sessions/:sessionId", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    const body = request.body as { title?: string };
    const session = store.updateSession(params.sessionId, { title: body.title });
    publish("session.updated", { session }, session.id);
    return { session };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.delete("/v1/sessions/:sessionId", async (request) => {
  const params = request.params as { sessionId: string };
  const deleted = store.deleteSession(params.sessionId);
  return { deleted };
});

app.get("/v1/sessions/:sessionId/messages", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    const session = mustGetSession(params.sessionId);
    const runtimeSessionId = mustGetRuntimeSessionId(session.id);
    const runtimeMessages = normalizeRuntimeMessages(session.id, await runtime.listMessages(runtimeSessionId));
    return { messages: mergeMessageSnapshots(store.listMessages(session.id), runtimeMessages) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/sessions/:sessionId/tracks", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    mustGetSession(params.sessionId);
    return { tracks: store.listTracks(params.sessionId) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/sessions/:sessionId/remote-jobs", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    mustGetSession(params.sessionId);
    return { jobs: store.listRemoteJobs(params.sessionId) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/sessions/:sessionId/plans", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    mustGetSession(params.sessionId);
    return { plans: store.listPlans(params.sessionId) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/sessions/:sessionId/annotations", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    mustGetSession(params.sessionId);
    return { annotations: store.listAnnotations(params.sessionId), staged: store.listStagedAnnotations(params.sessionId) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/sessions/:sessionId/reviews", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    mustGetSession(params.sessionId);
    return { reviews: store.listReviews(params.sessionId) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.post("/v1/sessions/:sessionId/stop", async (request, reply) => {
  try {
    const params = request.params as { sessionId: string };
    const session = mustGetSession(params.sessionId);
    const result = await stopSessionAndOwnedWork(session);
    if (result.runtimeError) throw result.runtimeError;
    return { session: result.session, stopped: result.stopped };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/files/tree", async (request, reply) => {
  try {
    const query = request.query as { path?: string };
    return { files: await runtime.listFiles({ path: query.path ?? "." }) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/files/content", async (request, reply) => {
  try {
    const query = request.query as { path?: string };
    if (!query.path) return reply.code(400).send({ code: "BAD_REQUEST", message: "path is required" });
    return { file: await runtime.readFile({ path: query.path }) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/files/search", async (request, reply) => {
  try {
    const query = request.query as { q?: string };
    if (!query.q) return reply.code(400).send({ code: "BAD_REQUEST", message: "q is required" });
    return { files: await runtime.searchFiles({ query: query.q }) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.post("/v1/uploads", async (_request, reply) => {
  return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "Upload storage is not implemented yet" });
});

app.post("/v1/plans", async (request, reply) => {
  try {
    const payload = planProposePayloadSchema.parse(request.body);
    const plan = createProposedPlan(payload);
    publish("plan.proposed", { plan }, plan.sessionId);
    return { plan };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/artifacts", async (request) => {
  const query = request.query as { sessionId?: string };
  return { artifacts: store.listArtifacts(query.sessionId) };
});

app.post("/v1/artifacts/register", async (request, reply) => {
  try {
    const payload = artifactRegisterPayloadSchema.parse(request.body);
    if (payload.sessionId) mustGetSession(payload.sessionId);
    const file = await readProjectFileMetadata(payload.path);
    const blobPath = await snapshotArtifactVersion(file.data);
    const provenance = resolveArtifactRegistrationProvenance(payload.sessionId, payload.sourceMessageIds, payload.provenance);
    const artifact = store.createOrVersionArtifact({
      sessionId: payload.sessionId,
      kind: payload.kind ?? inferArtifactKind(payload.name ?? file.name, payload.mimeType),
      name: payload.name ?? file.name,
      mimeType: payload.mimeType ?? file.mimeType,
      path: blobPath,
      size: file.size,
      sha256: file.sha256,
      sourceMessageIds: provenance.sourceMessageIds,
      provenance: provenance.provenance,
    });
    const publicResult = { ...artifact, version: toPublicArtifactVersion(artifact.version) };
    publish(artifact.created ? "artifact.created" : "artifact.versionCreated", { artifact: artifact.artifact, version: publicResult.version }, payload.sessionId);
    return publicResult;
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/artifacts/:artifactId", async (request, reply) => {
  const params = request.params as { artifactId: string };
  const artifact = store.getArtifact(params.artifactId);
  if (!artifact || artifact.deleted) return reply.code(404).send({ code: "NOT_FOUND", message: "Artifact not found" });
  return { artifact };
});

app.patch("/v1/artifacts/:artifactId", async (request, reply) => {
  try {
    const params = request.params as { artifactId: string };
    const body = artifactPatchPayloadSchema.parse(request.body ?? {});
    const artifact = store.updateArtifact(params.artifactId, body);
    publish("artifact.updated", { artifact }, artifact.sessionId);
    return { artifact };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.delete("/v1/artifacts/:artifactId", async (request, reply) => {
  try {
    const params = request.params as { artifactId: string };
    const artifact = store.updateArtifact(params.artifactId, { deleted: true });
    publish("artifact.deleted", { artifactId: artifact.id }, artifact.sessionId);
    return { deleted: true };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/artifacts/:artifactId/versions", async (request, reply) => {
  const params = request.params as { artifactId: string };
  const artifact = store.getArtifact(params.artifactId);
  if (!artifact || artifact.deleted) return reply.code(404).send({ code: "NOT_FOUND", message: "Artifact not found" });
  return { versions: store.listArtifactVersions(params.artifactId).map(toPublicArtifactVersion) };
});

app.get("/v1/artifacts/:artifactId/versions/:versionId/provenance", async (request, reply) => {
  const params = request.params as { artifactId: string; versionId: string };
  const artifact = store.getArtifact(params.artifactId);
  if (!artifact || artifact.deleted) return reply.code(404).send({ code: "NOT_FOUND", message: "Artifact not found" });
  const version = store.listArtifactVersions(params.artifactId).find((candidate) => candidate.id === params.versionId);
  if (!version) return reply.code(404).send({ code: "NOT_FOUND", message: "Artifact version not found" });
  return buildArtifactProvenance(artifact, version);
});

app.get("/v1/artifacts/:artifactId/versions/:versionId/download", async (_request, reply) => {
  try {
    const request = _request as { params: { artifactId: string; versionId: string } };
    const { artifact, version } = mustGetArtifactVersion(request.params.artifactId, request.params.versionId);
    const absolutePath = await resolveArtifactBlobPath(version.path);
    const data = await fs.promises.readFile(absolutePath);
    return reply
      .header("content-type", version.mimeType ?? artifact.mimeType ?? "application/octet-stream")
      .header("content-disposition", `attachment; filename="${sanitizeDownloadName(artifact.name)}"`)
      .send(data);
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/permissions", async () => {
  return { permissions: store.listPermissions(), grants: store.listPermissionGrants() };
});

app.post("/v1/permissions/revoke", async (request, reply) => {
  try {
    const payload = permissionRevokePayloadSchema.parse(request.body);
    return { permission: store.revokePermission(payload.permissionId) };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/settings", async () => {
  return {
    settings: {
      permissions: {},
      connectors: {},
      skills: {},
      networkAllowlist: [],
      compute: {},
      credentials: {},
      storage: {},
      memory: {},
      specialists: {},
      general: {},
    },
  };
});

app.patch("/v1/settings", async (_request) => {
  return { settings: {}, accepted: false, reason: "Settings persistence is not implemented yet" };
});

app.get("/v1/connectors", async (request, reply) => {
  try {
    return { connectors: await runtime.listMcp() };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/skills", async (request, reply) => {
  try {
    return { skills: await runtime.listCommands() };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/specialists", async (request, reply) => {
  try {
    return { specialists: await runtime.listAgents() };
  } catch (error) {
    return sendHttpError(reply, error);
  }
});

app.get("/v1/ws", { websocket: true }, (socket, request) => {
  hub.add(socket);
  const query = request.query as { lastEventId?: string };
  if (query.lastEventId && !store.hasEvent(query.lastEventId)) {
    hub.send(socket, {
      type: "error",
      code: "EVENT_REPLAY_UNAVAILABLE",
      message: "Event replay cursor is not available; refresh HTTP snapshots before continuing",
    });
  } else {
    for (const event of store.eventsAfter(query.lastEventId)) {
      hub.send(socket, event);
    }
  }

  socket.on("message", async (rawMessage: Buffer | string) => {
    let requestId: string | undefined;
    try {
      const parsed = clientCommandSchema.parse(JSON.parse(rawMessage.toString())) as ClientCommandEnvelope;
      requestId = parsed.requestId;
      hub.send(socket, { type: "ack", requestId: parsed.requestId });
      await handleCommand(parsed);
    } catch (error) {
      const adapterError = toAdapterError(error);
      hub.send(socket, {
        type: "error",
        requestId,
        code: adapterError.code,
        message: adapterError.message,
        details: adapterError.details,
      });
    }
  });
});

async function handleCommand(command: ClientCommandEnvelope): Promise<void> {
  switch (command.command) {
    case "session.create": {
      const payload = createSessionPayloadSchema.parse(command.payload ?? {});
      const runtimeSession = await runtime.createSession({ title: payload.title, parentId: payload.parentId });
      const session = store.createSession({ title: payload.title, runtimeSessionId: runtimeSession.id });
      publish("session.created", { session }, session.id);
      return;
    }
    case "session.open": {
      const payload = sessionOpenPayloadSchema.parse(command.payload);
      const session = mustGetSession(payload.sessionId);
      publish("session.updated", { session }, session.id);
      return;
    }
    case "session.sendMessage": {
      const payload = sendMessagePayloadSchema.parse(command.payload);
      const session = mustGetSession(payload.sessionId);
      const runtimeSessionId = mustGetRuntimeSessionId(session.id);
      const annotationIds = payload.annotationIds ?? [];
      const userMessageId = `msg_user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const annotations = annotationIds.length ? validateAnnotationsForMessage(annotationIds, session.id) : [];
      const userMessage = store.addMessage({
        id: userMessageId,
        sessionId: session.id,
        role: "user",
        status: "completed",
        parts: toAdapterMessageParts(userMessageId, payload.parts),
        createdAt: new Date().toISOString(),
      });
      const running = store.updateSession(session.id, { status: "running" });
      publishSessionStatus(running);
      publish("message.created", { sessionId: session.id, message: userMessage, messageId: userMessage.id, parts: payload.parts, annotationIds, annotations }, session.id);
      try {
        const result = await runtime.sendMessage({ runtimeSessionId, parts: payload.parts as MessagePart[] });
        if (annotationIds.length) validateAnnotationsForMessage(annotationIds, session.id);
        const committedAnnotations = annotationIds.length ? store.commitAnnotations(annotationIds, session.id, userMessageId) : [];
        if (committedAnnotations.length) publish("annotation.committed", { sessionId: session.id, messageId: userMessageId, annotations: committedAnnotations, clearedAnnotationIds: annotationIds }, session.id);
        publish("message.completed", { sessionId: session.id, message: normalizeRuntimeMessage(session.id, result) }, session.id);
        const updated = store.updateSession(session.id, { status: "idle" });
        publishSessionStatus(updated);
      } catch (error) {
        const adapterError = toAdapterError(error);
        publish("message.failed", { sessionId: session.id, error: adapterError }, session.id);
        const updated = store.updateSession(session.id, { status: "error" });
        publishSessionStatus(updated);
        throw error;
      }
      return;
    }
    case "session.stop": {
      const payload = stopSessionPayloadSchema.parse(command.payload);
      const session = mustGetSession(payload.sessionId);
      const result = await stopSessionAndOwnedWork(session);
      if (result.runtimeError) throw result.runtimeError;
      return;
    }
    case "permission.respond": {
      const payload = permissionResponsePayloadSchema.parse(command.payload);
      const existing = store.updatePermission(payload.permissionId, {});
      const mapping = store.getRuntimePermissionMapping(existing.id);
      if (!mapping?.runtimeSessionId || !mapping.runtimePermissionId) {
        throw new Error(`Permission has no runtime mapping: ${existing.id}`);
      }
      const scope = payload.decision === "approve" ? (payload.scope ?? "once") : undefined;
      await runtime.respondToPermission({
        runtimeSessionId: mapping.runtimeSessionId,
        runtimePermissionId: mapping.runtimePermissionId,
        decision: payload.decision,
        scope,
      });
      const permission = store.updatePermission(payload.permissionId, {
        status: payload.decision === "approve" ? "approved" : "denied",
        grantedScope: scope,
      });
      const grant = scope && scope !== "once" ? store.createPermissionGrant(permission, scope) : undefined;
      publish("permission.resolved", { permission, grant }, permission.sessionId);
      return;
    }
    case "plan.propose": {
      const payload = planProposePayloadSchema.parse(command.payload);
      const plan = createProposedPlan(payload);
      publish("plan.proposed", { plan }, plan.sessionId);
      return;
    }
    case "plan.approve": {
      const payload = planApprovePayloadSchema.parse(command.payload);
      approvePlan(payload.planId);
      return;
    }
    case "plan.requestRevision": {
      const payload = planRequestRevisionPayloadSchema.parse(command.payload);
      const existing = store.getPlan(payload.planId);
      if (!existing) throw new Error(`Plan not found: ${payload.planId}`);
      if (existing.status !== "awaiting_approval") throw new Error("Plan revision can only be requested while awaiting approval");
      const revised = store.createPlan({
        sessionId: existing.sessionId,
        title: existing.title,
        summary: existing.summary,
        steps: existing.steps.map((step) => ({
          title: step.title,
          description: step.description,
          executionStepIds: step.executionStepIds,
        })),
        supersedesPlanId: existing.id,
        revisionRequest: payload.message,
      });
      store.updatePlan(existing.id, { status: "revision_requested" });
      publish("plan.updated", { plan: revised, supersedesPlanId: existing.id, revisionRequest: payload.message }, revised.sessionId);
      return;
    }
    case "plan.recordStepResult": {
      const payload = planRecordStepResultPayloadSchema.parse(command.payload);
      recordPlanStepResult(payload.planId, payload.stepId, payload.executionStepIds);
      return;
    }
    case "annotation.stage": {
      const payload = annotationStagePayloadSchema.parse(command.payload);
      mustGetSession(payload.sessionId);
      const { artifact, version } = mustGetArtifactVersion(payload.artifactId, payload.versionId);
      ensureArtifactOwnedBySession(artifact, payload.sessionId);
      const annotation = store.createAnnotation({
        sessionId: payload.sessionId,
        artifactId: payload.artifactId,
        versionId: version.id,
        body: payload.body,
        anchor: payload.anchor,
      });
      publish("annotation.staged", { annotation, staged: store.listStagedAnnotations(payload.sessionId) }, payload.sessionId);
      return;
    }
    case "annotation.discard": {
      const payload = annotationDiscardPayloadSchema.parse(command.payload);
      const annotations = store.discardAnnotations(payload.annotationIds);
      publish("annotation.discarded", { annotationIds: payload.annotationIds, annotations }, annotations[0]?.sessionId);
      return;
    }
    case "annotation.commitWithMessage": {
      const payload = annotationCommitWithMessagePayloadSchema.parse(command.payload);
      await sendSessionMessageWithAnnotations(payload.sessionId, payload.parts as MessagePart[], payload.annotationIds);
      return;
    }
    case "reviewer.run": {
      const payload = reviewerRunPayloadSchema.parse(command.payload);
      runReviewer(payload);
      return;
    }
    case "track.spawn": {
      const payload = trackSpawnPayloadSchema.parse(command.payload);
      mustGetSession(payload.sessionId);
      if (payload.parentTrackId) ensureTrackInSession(payload.parentTrackId, payload.sessionId);
      const track = store.createTrack(payload);
      publish("track.created", { track }, track.sessionId);
      publish("track.statusChanged", { track, status: track.status }, track.sessionId);
      return;
    }
    case "track.update": {
      const payload = trackUpdatePayloadSchema.parse(command.payload);
      const track = store.updateTrack(payload.trackId, payload);
      publish("track.statusChanged", { track, status: track.status, message: payload.message, error: payload.error }, track.sessionId);
      if (payload.message) publish("track.message", { trackId: track.id, message: payload.message }, track.sessionId);
      if (track.status === "completed" || track.status === "failed") publish("track.completed", { track, status: track.status }, track.sessionId);
      return;
    }
    case "track.stop": {
      const payload = trackStopPayloadSchema.parse(command.payload);
      const track = store.stopTrack(payload.trackId, payload.reason);
      publish("track.statusChanged", { track, status: track.status, reason: payload.reason }, track.sessionId);
      publish("track.completed", { track, status: track.status }, track.sessionId);
      return;
    }
    case "remoteJob.submit": {
      const payload = remoteJobSubmitPayloadSchema.parse(command.payload);
      mustGetSession(payload.sessionId);
      if (payload.trackId) ensureTrackInSession(payload.trackId, payload.sessionId);
      const job = store.createRemoteJob(payload);
      publish("remoteJob.submitted", { job }, job.sessionId);
      publish("remoteJob.statusChanged", { job, status: job.status }, job.sessionId);
      return;
    }
    case "remoteJob.update": {
      const payload = remoteJobUpdatePayloadSchema.parse(command.payload);
      const existing = mustGetRemoteJob(payload.jobId);
      const artifactIds = payload.artifactIds ? validateRemoteJobArtifacts(existing.sessionId, payload.artifactIds) : undefined;
      const job = store.updateRemoteJob(payload.jobId, { ...payload, artifactIds });
      publish("remoteJob.statusChanged", { job, status: job.status, error: payload.error }, job.sessionId);
      return;
    }
    case "remoteJob.appendLog": {
      const payload = remoteJobAppendLogPayloadSchema.parse(command.payload);
      const { job, log } = store.appendRemoteJobLog(payload.jobId, { stream: payload.stream, text: payload.text });
      publish("remoteJob.logAppended", { jobId: job.id, log }, job.sessionId);
      return;
    }
    case "artifact.star": {
      const payload = artifactStarPayloadSchema.parse(command.payload);
      const artifact = store.updateArtifact(payload.artifactId, { starred: payload.starred });
      publish("artifact.updated", { artifact }, artifact.sessionId);
      return;
    }
    case "artifact.rename": {
      const payload = artifactRenamePayloadSchema.parse(command.payload);
      const artifact = store.updateArtifact(payload.artifactId, { name: payload.name });
      publish("artifact.updated", { artifact }, artifact.sessionId);
      return;
    }
    case "artifact.delete": {
      const payload = artifactIdPayloadSchema.parse(command.payload);
      const artifact = store.updateArtifact(payload.artifactId, { deleted: true });
      publish("artifact.deleted", { artifactId: artifact.id }, artifact.sessionId);
      return;
    }
    case "artifact.open": {
      const payload = artifactOpenPayloadSchema.parse(command.payload);
      const { artifact, version } = mustGetArtifactVersion(payload.artifactId, payload.versionId);
      publish(
        "artifact.opened",
        { artifact, version: toPublicArtifactVersion(version), mode: payload.mode ?? "primary" },
        artifact.sessionId,
      );
      return;
    }
    case "artifact.downloadUrl": {
      const payload = artifactDownloadUrlPayloadSchema.parse(command.payload);
      const { artifact, version } = mustGetArtifactVersion(payload.artifactId, payload.versionId);
      const downloadUrl = `/v1/artifacts/${encodeURIComponent(artifact.id)}/versions/${encodeURIComponent(version.id)}/download`;
      publish("artifact.downloadUrlCreated", { artifactId: artifact.id, versionId: version.id, downloadUrl }, artifact.sessionId);
      return;
    }
    default:
      throw new AdapterCommandNotImplementedError(`Command is not implemented yet: ${command.command}`);
  }
}

async function sendSessionMessageWithAnnotations(sessionId: string, parts: MessagePart[], annotationIds: string[]): Promise<void> {
  const session = mustGetSession(sessionId);
  const runtimeSessionId = mustGetRuntimeSessionId(session.id);
  const userMessageId = `msg_user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const annotations = annotationIds.length ? validateAnnotationsForMessage(annotationIds, session.id) : [];
  const running = store.updateSession(session.id, { status: "running" });
  publishSessionStatus(running);
  publish("message.created", { sessionId: session.id, messageId: userMessageId, parts, annotationIds, annotations }, session.id);
  try {
    const result = await runtime.sendMessage({ runtimeSessionId, parts });
    if (annotationIds.length) validateAnnotationsForMessage(annotationIds, session.id);
    const committedAnnotations = annotationIds.length ? store.commitAnnotations(annotationIds, session.id, userMessageId) : [];
    if (committedAnnotations.length) publish("annotation.committed", { sessionId: session.id, messageId: userMessageId, annotations: committedAnnotations, clearedAnnotationIds: annotationIds }, session.id);
    publish("message.completed", { sessionId: session.id, message: normalizeRuntimeMessage(session.id, result) }, session.id);
    const updated = store.updateSession(session.id, { status: "idle" });
    publishSessionStatus(updated);
  } catch (error) {
    const adapterError = toAdapterError(error);
    publish("message.failed", { sessionId: session.id, error: adapterError }, session.id);
    const updated = store.updateSession(session.id, { status: "error" });
    publishSessionStatus(updated);
    throw error;
  }
}

function validateAnnotationsForMessage(annotationIds: string[], sessionId: string) {
  const annotations = store.validateAnnotationsForCommit(annotationIds, sessionId);
  for (const annotation of annotations) {
    const { artifact } = mustGetArtifactVersion(annotation.artifactId, annotation.versionId);
    ensureArtifactOwnedBySession(artifact, sessionId);
  }
  return annotations;
}

function mustGetTrack(trackId: string) {
  const track = store.getTrack(trackId);
  if (!track) throw new Error(`Track not found: ${trackId}`);
  return track;
}

function ensureTrackInSession(trackId: string, sessionId: string) {
  const track = mustGetTrack(trackId);
  if (track.sessionId !== sessionId) throw new Error("Track is not in this session");
  return track;
}

function mustGetRemoteJob(jobId: string) {
  const job = store.getRemoteJob(jobId);
  if (!job) throw new Error(`Remote job not found: ${jobId}`);
  return job;
}

function validateRemoteJobArtifacts(sessionId: string, artifactIds: string[]): string[] {
  const uniqueIds = [...new Set(artifactIds)];
  if (uniqueIds.length !== artifactIds.length) throw new Error("Duplicate remote job artifact IDs are not allowed");
  for (const artifactId of uniqueIds) {
    const artifact = store.getArtifact(artifactId);
    if (!artifact || artifact.deleted) throw new Error(`Artifact not found: ${artifactId}`);
    ensureArtifactStrictlyOwnedBySession(artifact, sessionId);
  }
  return uniqueIds;
}

function stopSessionWork(sessionId: string) {
  return store.stopSessionWork(sessionId);
}

function publishStoppedWork(stopped: ReturnType<typeof stopSessionWork>, sessionId: string): void {
  for (const track of stopped.tracks) {
    publish("track.statusChanged", { track, status: track.status, reason: "Session stopped" }, sessionId);
    publish("track.completed", { track, status: track.status }, sessionId);
  }
  for (const job of stopped.remoteJobs) {
    publish("remoteJob.statusChanged", { job, status: job.status, error: job.error }, sessionId);
  }
}

async function stopSessionAndOwnedWork(session: SessionRecord): Promise<{
  session: SessionRecord;
  stopped: ReturnType<typeof stopSessionWork>;
  runtimeError?: unknown;
}> {
  let runtimeError: unknown;
  const runtimeSessionId = store.getRuntimeSessionId(session.id);
  if (runtimeSessionId) {
    try {
      await runtime.stopSession(runtimeSessionId);
    } catch (error) {
      runtimeError = error;
    }
  }
  const stopped = stopSessionWork(session.id);
  const updated = store.updateSession(session.id, { status: "stopped" });
  publishStoppedWork(stopped, session.id);
  publishSessionStatus(updated);
  return { session: updated, stopped, runtimeError };
}

function runReviewer(payload: {
  sessionId: string;
  artifactId?: string;
  versionId?: string;
  mode?: "manual" | "automatic";
  findings?: Array<{ severity: "info" | "warning" | "error"; claim: string; evidence: string; transcriptUrl: string; provenanceUrl: string }>;
  failReason?: string;
}): void {
  mustGetSession(payload.sessionId);
  if (payload.artifactId || payload.versionId) {
    if (!payload.artifactId || !payload.versionId) throw new Error("Reviewer artifact target requires artifactId and versionId");
    const { artifact } = mustGetArtifactVersion(payload.artifactId, payload.versionId);
    ensureArtifactStrictlyOwnedBySession(artifact, payload.sessionId);
  }
  if (payload.mode === "automatic") throw new AdapterCommandNotImplementedError("Automatic reviewer execution is not implemented yet");
  const providedFindings = payload.findings ?? [];
  if (!payload.failReason && !providedFindings.length) throw new Error("Reviewer run requires explicit findings or failReason");
  const findings = providedFindings.length ? validateReviewerFindingLinks({ ...payload, findings: providedFindings }) : [];
  const review = store.createReview({
    sessionId: payload.sessionId,
    artifactId: payload.artifactId,
    versionId: payload.versionId,
    mode: payload.mode,
  });
  publish("review.started", { review }, review.sessionId);
  if (payload.failReason) {
    const failed = store.failReview(review.id, payload.failReason);
    publish("review.completed", { review: failed, status: "failed", error: payload.failReason }, review.sessionId);
    return;
  }
  const completed = store.completeReview(review.id, findings);
  publish("review.findings", { reviewId: completed.id, findings: completed.findings }, completed.sessionId);
  publish("review.completed", { review: completed, status: "completed" }, completed.sessionId);
}

function validateReviewerFindingLinks(payload: {
  sessionId: string;
  artifactId?: string;
  versionId?: string;
  findings: Array<{ severity: "info" | "warning" | "error"; claim: string; evidence: string; transcriptUrl: string; provenanceUrl: string }>;
}) {
  const expectedProvenanceUrl =
    payload.artifactId && payload.versionId
      ? artifactProvenanceUrl(payload.artifactId, payload.versionId)
      : `/v1/sessions/${payload.sessionId}/reviews`;
  for (const finding of payload.findings) {
    const transcriptMessageId = parseTranscriptMessageId(finding.transcriptUrl);
    if (!transcriptMessageId || !store.hasMessage(payload.sessionId, transcriptMessageId)) {
      throw new Error("Reviewer transcript link is not known in this session");
    }
    if (finding.provenanceUrl !== expectedProvenanceUrl) {
      throw new Error("Reviewer provenance link does not match the reviewed target");
    }
  }
  return payload.findings;
}

function parseTranscriptMessageId(transcriptUrl: string): string | undefined {
  const match = /^#(msg_[A-Za-z0-9_-]+)$/.exec(transcriptUrl);
  return match?.[1];
}

function artifactProvenanceUrl(artifactId: string, versionId: string): string {
  return `/v1/artifacts/${artifactId}/versions/${versionId}/provenance`;
}

function publish(name: EventEnvelope["name"], payload: unknown, sessionId?: string): EventEnvelope {
  const event = store.appendEvent(name, payload, sessionId);
  hub.broadcast(event);
  return event;
}

function publishSessionStatus(session: SessionRecord): EventEnvelope {
  return publish("session.statusChanged", { session, status: session.status }, session.id);
}

function createProposedPlan(payload: {
  sessionId: string;
  title?: string;
  summary?: string;
  steps: Array<{ title: string; description?: string; executionStepIds?: string[] }>;
}) {
  mustGetSession(payload.sessionId);
  const steps = payload.steps.map((step) => ({
    ...step,
    executionStepIds: validatePlanExecutionStepIds(payload.sessionId, step.executionStepIds ?? []),
  }));
  return store.createPlan({
    sessionId: payload.sessionId,
    title: payload.title,
    summary: payload.summary,
    steps,
  });
}

function approvePlan(planId: string): void {
  const plan = store.getPlan(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  if (plan.status !== "awaiting_approval") throw new Error("Plan can only be approved while awaiting approval");
  const approved = store.updatePlan(plan.id, { status: "approved", approvedAt: new Date().toISOString() });
  publish("plan.approved", { plan: approved }, approved.sessionId);
}

function recordPlanStepResult(planId: string, stepId: string, executionStepIds: string[]): void {
  const plan = store.getPlan(planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  if (plan.status !== "approved" && plan.status !== "running") throw new Error("Plan step results can only be recorded after approval");
  const step = plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Plan step not found: ${stepId}`);
  if (step.status === "completed") throw new Error("Plan step is already completed");
  const validatedExecutionStepIds = validatePlanExecutionStepIds(plan.sessionId, executionStepIds);
  const startedAt = step.startedAt ?? new Date().toISOString();
  const runningSteps = plan.steps.map((candidate) =>
    candidate.id === step.id
      ? { ...candidate, status: "running" as const, startedAt, executionStepIds: validatedExecutionStepIds }
      : candidate,
  );
  const running = store.updatePlan(plan.id, { status: "running", steps: runningSteps });
  publish("plan.stepStarted", { planId: plan.id, step: running.steps[step.index] }, plan.sessionId);
  const completedAt = new Date().toISOString();
  const completedSteps = running.steps.map((candidate) =>
    candidate.id === step.id ? { ...candidate, status: "completed" as const, completedAt } : candidate,
  );
  const updated = store.updatePlan(plan.id, { steps: completedSteps });
  publish("plan.stepCompleted", { planId: plan.id, step: updated.steps[step.index] }, plan.sessionId);
  if (updated.steps.every((candidate) => candidate.status === "completed")) {
    const completed = store.updatePlan(plan.id, { status: "completed", completedAt: new Date().toISOString() });
    publish("plan.completed", { plan: completed }, completed.sessionId);
  }
}

function validatePlanExecutionStepIds(sessionId: string, executionStepIds: string[]): string[] {
  for (const executionStepId of executionStepIds) {
    const record = store.getExecutionLog(executionStepId);
    if (!record || record.sessionId !== sessionId) throw new Error("Plan execution step is not known in this session");
    if (record.status !== "completed") throw new Error("Plan execution step is not completed");
  }
  return executionStepIds;
}

function startRuntimeEventSubscription(): void {
  if (runtimeEventsController) return;
  const controller = new AbortController();
  runtimeEventsController = controller;
  void runRuntimeEventSubscription(controller);
}

function stopRuntimeEventSubscription(): void {
  runtimeEventsController?.abort();
  runtimeEventsController = undefined;
}

async function runRuntimeEventSubscription(controller: AbortController): Promise<void> {
  while (!controller.signal.aborted) {
    try {
      await runtime.subscribeEvents({
        signal: controller.signal,
        onEvent: (event) => {
          for (const normalized of normalizeRuntimeEvent(event, (runtimeSessionId) => store.getSessionIdByRuntimeSessionId(runtimeSessionId))) {
        void publishNormalizedRuntimeEvent(normalized);
          }
        },
        onError: (error) => {
          if (!controller.signal.aborted) app.log.warn({ error }, "OpenCode event stream error");
        },
      });
      if (!controller.signal.aborted) {
        publish("runtime.statusChanged", { status: "disconnected", message: "OpenCode event stream disconnected; reconnecting" });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        app.log.warn({ error }, "OpenCode event stream failed");
        publish("runtime.statusChanged", { status: "error", message: "OpenCode event stream failed; reconnecting" });
      }
    }
    if (!controller.signal.aborted) await sleep(500);
  }
  if (runtimeEventsController === controller) runtimeEventsController = undefined;
}

async function publishNormalizedRuntimeEvent(event: NormalizedRuntimeEvent): Promise<void> {
  if (event.name === "session.statusChanged") {
    const session = store.getSession(event.sessionId);
    if (!session) return;
    const updated = store.updateSession(session.id, { status: event.payload.status === "running" ? "running" : event.payload.status });
    publishSessionStatus(updated);
    return;
  }

  if (event.name === "permission.requested") {
    const runtimeSessionId = store.getRuntimeSessionId(event.sessionId);
    const permission = store.createPermission({
      sessionId: event.sessionId,
      type: normalizePermissionType(event.payload.runtimePermission.type),
      title: event.payload.runtimePermission.title,
      summary: event.payload.runtimePermission.summary,
      details: event.payload.runtimePermission.metadata,
      runtime: {
        runtimeSessionId,
        runtimePermissionId: event.payload.runtimePermission.runtimePermissionId,
      },
    });
    const grant = store.findActivePermissionGrant(permission);
    if (grant && runtimeSessionId && event.payload.runtimePermission.runtimePermissionId) {
      await runtime.respondToPermission({
        runtimeSessionId,
        runtimePermissionId: event.payload.runtimePermission.runtimePermissionId,
        decision: "approve",
        scope: grant.scope,
      });
      const resolved = store.updatePermission(permission.id, {
        status: "approved",
        grantedScope: grant.scope,
        appliedGrantId: grant.id,
      });
      publish("permission.resolved", { permission: resolved, grant }, event.sessionId);
      return;
    }
    publish("permission.requested", { permission }, event.sessionId);
    return;
  }

  publish(event.name as AdapterEventName, event.payload, "sessionId" in event ? event.sessionId : undefined);
}

function normalizePermissionType(type: string): PermissionType {
  if (type === "bash" || type === "shell") return "shell";
  if (type === "webfetch" || type === "network") return "network_host";
  if (type === "edit" || type === "file") return "folder_access";
  if (type === "python") return "python";
  if (type === "package") return "install_package";
  if (type === "connector") return "connector";
  return "credential";
}

async function readProjectFileMetadata(inputPath: string): Promise<{
  name: string;
  size: number;
  sha256: string;
  mimeType: string;
  data: Buffer;
}> {
  const absolutePath = await resolveProjectPath(inputPath);
  const stat = await fs.promises.stat(absolutePath);
  if (!stat.isFile()) throw new Error(`Artifact path is not a file: ${inputPath}`);
  const data = await fs.promises.readFile(absolutePath);
  return {
    name: path.basename(absolutePath),
    size: stat.size,
    sha256: createHash("sha256").update(data).digest("hex"),
    mimeType: inferMimeType(absolutePath),
    data,
  };
}

async function resolveProjectPath(inputPath: string): Promise<string> {
  const absolutePath = path.resolve(adapterConfig.projectRoot, inputPath);
  const relative = path.relative(adapterConfig.projectRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside project root: ${inputPath}`);
  }
  const [realProjectRoot, realTarget] = await Promise.all([fs.promises.realpath(adapterConfig.projectRoot), fs.promises.realpath(absolutePath)]);
  const realRelative = path.relative(realProjectRoot, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`Path is outside project root: ${inputPath}`);
  }
  return absolutePath;
}

async function snapshotArtifactVersion(data: Buffer): Promise<string> {
  const versionDir = path.join(artifactBlobRoot, "versions");
  await fs.promises.mkdir(versionDir, { recursive: true });
  const fileName = `blob_${createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex")}`;
  const absolutePath = path.join(versionDir, fileName);
  await fs.promises.writeFile(absolutePath, data);
  return path.relative(artifactBlobRoot, absolutePath).replace(/\\/g, "/");
}

async function resolveArtifactBlobPath(inputPath: string): Promise<string> {
  const absolutePath = path.resolve(artifactBlobRoot, inputPath);
  const relative = path.relative(artifactBlobRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Artifact blob path is outside adapter storage: ${inputPath}`);
  }
  const [realBlobRoot, realTarget] = await Promise.all([fs.promises.realpath(artifactBlobRoot), fs.promises.realpath(absolutePath)]);
  const realRelative = path.relative(realBlobRoot, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error(`Artifact blob path is outside adapter storage: ${inputPath}`);
  }
  return absolutePath;
}

function toPublicArtifactVersion(version: {
  id: string;
  artifactId: string;
  version: number;
  createdAt: string;
  sourceMessageIds: string[];
  size: number;
  sha256: string;
  mimeType?: string;
}) {
  return {
    id: version.id,
    artifactId: version.artifactId,
    version: version.version,
    createdAt: version.createdAt,
    sourceMessageIds: version.sourceMessageIds,
    size: version.size,
    sha256: version.sha256,
    mimeType: version.mimeType,
  };
}

function buildArtifactProvenance(artifact: ArtifactRecord, version: ArtifactVersionRecord) {
  const executionLog = store.listExecutionLogs(version.provenance.executionStepIds).map(toPublicExecutionLog);
  const messages = version.sourceMessageIds.map((messageId) => ({ messageId }));
  const code = version.provenance.code.map((entry, index) => ({
    id: `code_${index + 1}`,
    language: entry.language,
    content: entry.content,
    description: entry.description,
  }));
  const environment = {
    adapter: {
      version: "0.1.0",
      storage: "adapter-owned",
    },
    runtime: {
      kind: "opencode",
      sdkVersion: adapterConfig.opencode.sdkVersion,
    },
    artifact: {
      kind: artifact.kind,
      mimeType: version.mimeType ?? artifact.mimeType,
      size: version.size,
      sha256: version.sha256,
    },
    provided: version.provenance.environment,
  };
  const reviewEvidence = version.provenance.review.filter((entry) => entry.type === "finding" || entry.type === "summary");
  const reviewNotRun = version.provenance.review.find((entry) => entry.type === "not_run");
  const tabCompleteness: Record<string, { status: "linked" | "partial" | "missing"; reason?: string }> = {
    messages: provenanceCompleteness(messages.length > 0, "No source message IDs were linked when this artifact version was registered"),
    code: provenanceCompleteness(code.length > 0, "No producing code was captured for this artifact version"),
    executionLog: provenanceCompleteness(executionLog.length > 0, "No execution step IDs were linked when this artifact version was registered"),
    environment: { status: "partial" as const, reason: "Adapter/runtime/artifact summary is present; full kernel or package environment capture is not implemented yet" },
    review: reviewEvidence.length
      ? { status: "linked" }
      : reviewNotRun
        ? { status: "missing", reason: reviewNotRun.reason ?? "Reviewer was not run for this artifact version" }
        : provenanceCompleteness(false, "No reviewer output is linked to this artifact version"),
  };
  const missing = Object.entries(tabCompleteness)
    .filter(([, value]) => value.status === "missing")
    .map(([key]) => key);
  return {
    artifactId: artifact.id,
    versionId: version.id,
    status: Object.values(tabCompleteness).every((value) => value.status === "linked") ? "complete" : "partial",
    completeness: tabCompleteness,
    missing,
    tabs: {
      messages,
      code,
      executionLog,
      environment,
      review: reviewEvidence,
    },
  };
}

function resolveArtifactRegistrationProvenance(
  sessionId: string | undefined,
  sourceMessageIds: string[] | undefined,
  provenance:
    | {
        executionStepIds?: string[];
        code?: Array<{ language: string; content?: string; description?: string }>;
        environment?: Record<string, unknown>;
        review?: Array<{ type: "summary"; summary: string } | { type: "not_run"; reason?: string }>;
      }
    | undefined,
) {
  if (!sessionId && ((sourceMessageIds?.length ?? 0) > 0 || (provenance?.executionStepIds?.length ?? 0) > 0)) {
    throw new Error("Artifact provenance message and execution links require a sessionId");
  }
  const linkedMessageIds = sourceMessageIds ?? [];
  for (const messageId of linkedMessageIds) {
    if (!sessionId || !store.hasMessage(sessionId, messageId)) {
      throw new Error("Artifact provenance message is not known in this session");
    }
  }
  const executionStepIds = provenance?.executionStepIds ?? [];
  for (const stepId of executionStepIds) {
    const record = store.getExecutionLog(stepId);
    if (!record || record.sessionId !== sessionId) {
      throw new Error("Artifact provenance execution step is not known in this session");
    }
  }
  return {
    sourceMessageIds: linkedMessageIds,
    provenance: provenance
      ? {
          ...provenance,
          executionStepIds,
          environment: stripReservedEnvironmentKeys(provenance.environment ?? {}),
        }
      : undefined,
  };
}

function stripReservedEnvironmentKeys(environment: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !["adapter", "runtime", "artifact"].includes(key)));
}

function toPublicExecutionLog(record: ExecutionLogRecord) {
  return {
    stepId: record.stepId,
    sessionId: record.sessionId,
    kind: record.kind,
    tool: record.tool,
    title: record.title,
    input: record.input,
    stdout: record.stdout,
    stderr: record.stderr ?? "",
    exitCode: record.exitCode,
    status: record.status,
    error: record.error,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

function toAdapterMessageParts(messageId: string, parts: MessagePart[]): AdapterMessagePart[] {
  return parts.map((part, index) => {
    if (part.type === "text") return { id: `${messageId}_part_${index}`, type: "text", text: part.text };
    return { id: `${messageId}_part_${index}`, type: "unsupported" };
  });
}

function mergeMessageSnapshots(...groups: AdapterMessage[][]): AdapterMessage[] {
  const messages = new Map<string, AdapterMessage>();
  for (const group of groups) {
    for (const message of group) {
      if (isDuplicateUserMessage([...messages.values()], message)) continue;
      messages.set(message.id, message);
    }
  }
  return [...messages.values()].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

function isDuplicateUserMessage(existingMessages: AdapterMessage[], message: AdapterMessage): boolean {
  if (message.role !== "user") return false;
  const text = messageText(message);
  if (!text) return false;
  const createdAt = Date.parse(message.createdAt ?? "");
  return existingMessages.some((existing) => {
    if (existing.sessionId !== message.sessionId || existing.role !== "user" || messageText(existing) !== text) return false;
    const existingCreatedAt = Date.parse(existing.createdAt ?? "");
    if (!Number.isFinite(createdAt) || !Number.isFinite(existingCreatedAt)) return true;
    return Math.abs(createdAt - existingCreatedAt) < 10_000;
  });
}

function messageText(message: AdapterMessage): string {
  return message.parts
    .filter((part): part is Extract<AdapterMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function provenanceCompleteness(hasValue: boolean, missingReason: string) {
  return hasValue ? { status: "linked" as const } : { status: "missing" as const, reason: missingReason };
}

function inferArtifactKind(name: string, mimeType?: string): ArtifactKind {
  const normalized = name.toLowerCase();
  if (mimeType?.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(normalized)) return "figure";
  if (mimeType === "application/pdf" || normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".ipynb")) return "notebook";
  if (/\.(csv|tsv|xlsx|xls|parquet)$/.test(normalized)) return "table";
  if (/\.(md|markdown)$/.test(normalized)) return "markdown";
  if (/\.(html|htm)$/.test(normalized)) return "html";
  if (/\.(ts|tsx|js|jsx|py|r|rs|go|java|c|cpp|h|hpp|json|yaml|yml|toml|css|scss)$/.test(normalized)) return "code";
  return "unknown";
}

function inferMimeType(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) return "text/markdown";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".ipynb")) return "application/x-ipynb+json";
  if (normalized.endsWith(".json")) return "application/json";
  if (normalized.endsWith(".csv")) return "text/csv";
  if (normalized.endsWith(".tsv")) return "text/tab-separated-values";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "text/html";
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".svg")) return "image/svg+xml";
  if (/\.(ts|tsx|js|jsx|py|r|rs|go|java|c|cpp|h|hpp|yaml|yml|toml|css|scss)$/.test(normalized)) return "text/plain";
  return "application/octet-stream";
}

function sanitizeDownloadName(name: string): string {
  return name.replace(/["\r\n]/g, "_");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function mustGetSession(sessionId: string) {
  const session = store.getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  return session;
}

function mustGetRuntimeSessionId(sessionId: string): string {
  const runtimeSessionId = store.getRuntimeSessionId(sessionId);
  if (!runtimeSessionId) throw new Error(`Session has no runtime mapping: ${sessionId}`);
  return runtimeSessionId;
}

function mustGetArtifactVersion(artifactId: string, versionId?: string) {
  const artifact = store.getArtifact(artifactId);
  if (!artifact || artifact.deleted) throw new Error(`Artifact not found: ${artifactId}`);
  const effectiveVersionId = versionId ?? artifact.currentVersionId;
  const version = store.listArtifactVersions(artifact.id).find((candidate) => candidate.id === effectiveVersionId);
  if (!version) throw new Error(`Artifact version not found: ${effectiveVersionId}`);
  return { artifact, version };
}

function ensureArtifactOwnedBySession(artifact: ArtifactRecord, sessionId: string): void {
  if (artifact.sessionId && artifact.sessionId !== sessionId) throw new Error("Artifact is not in this session");
}

function ensureArtifactStrictlyOwnedBySession(artifact: ArtifactRecord, sessionId: string): void {
  if (artifact.sessionId !== sessionId) throw new Error("Artifact is not in this session");
}

function sendHttpError(reply: { code(statusCode: number): { send(body: unknown): unknown } }, error: unknown) {
  const adapterError = toAdapterError(error);
  return reply.code(adapterError.statusCode).send(adapterError);
}

function getAllowedCorsOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  return adapterConfig.corsOrigins.includes("*") || adapterConfig.corsOrigins.includes(origin) ? origin : undefined;
}

try {
  await app.listen({ host: adapterConfig.host, port: adapterConfig.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

try {
  await runtimeManager.start();
  if ((await runtime.health()).connected) startRuntimeEventSubscription();
} catch (error) {
  app.log.error(error, "Runtime manager failed to start");
}

const shutdown = async () => {
  stopRuntimeEventSubscription();
  await runtimeManager.stop();
  await app.close();
};

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
