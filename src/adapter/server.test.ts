import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const processes: ChildProcessWithoutNullStreams[] = [];
const servers: http.Server[] = [];
const storageRoots: string[] = [];

describe("adapter session chat lifecycle", () => {
  afterEach(async () => {
    for (const child of processes.splice(0)) {
      stopProcessTree(child);
    }
    await Promise.all(servers.splice(0).map(closeServer));
    await fs.promises.rm(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true, force: true });
    await fs.promises.rm(path.join(process.cwd(), ".adapter-artifacts"), { recursive: true, force: true });
    await Promise.all(storageRoots.splice(0).map((storageRoot) => fs.promises.rm(storageRoot, { recursive: true, force: true })));
  });

  it("creates a public session and sends a text message through WebSocket", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);

    const created = await jsonFetch<{ session: Record<string, unknown> }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test" }),
    });

    expect(created.session.id).toEqual(expect.stringMatching(/^ses_/));
    expect(created.session).not.toHaveProperty("runtimeSessionId");

    const envelopes = await sendWsCommand(adapter.wsUrl, {
      type: "command",
      requestId: "req_success",
      command: "session.sendMessage",
      payload: {
        sessionId: created.session.id,
        parts: [{ type: "text", text: "Reply exactly: OK" }],
      },
    });

    expect(envelopes.map(labelEnvelope)).toEqual([
      "ack",
      "session.statusChanged",
      "message.created",
      "message.completed",
      "session.statusChanged",
    ]);
    expect(JSON.stringify(envelopes)).not.toContain(fakeOpenCode.runtimeSessionId);
    expect(JSON.stringify(envelopes)).not.toContain(fakeOpenCode.runtimeMessageId);

    const listed = await jsonFetch<{ messages: Array<Record<string, unknown>> }>(
      `${adapter.baseUrl}/v1/sessions/${created.session.id}/messages`,
    );
    expect(listed.messages).toHaveLength(2);
    expect(listed.messages[0]).toMatchObject({
      id: expect.stringMatching(/^msg_/),
      sessionId: created.session.id,
      role: "user",
      status: "completed",
      parts: [{ id: expect.stringMatching(/^msg_.*_part_0$/), type: "text", text: "Reply exactly: OK" }],
    });
    expect(listed.messages[1]).toMatchObject({
      id: expect.stringMatching(/^msg_/),
      sessionId: created.session.id,
      role: "assistant",
      status: "completed",
      parts: [{ id: expect.stringMatching(/^part_/), type: "text", text: "OK" }],
    });
    expect(JSON.stringify(listed)).not.toContain(fakeOpenCode.runtimeSessionId);
    expect(JSON.stringify(listed)).not.toContain(fakeOpenCode.runtimeMessageId);
  }, 20_000);

  it("emits message.failed and moves the session to error on unsupported parts", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-failure" }),
    });

    const envelopes = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_failure",
        command: "session.sendMessage",
        payload: {
          sessionId: created.session.id,
          parts: [{ type: "artifact_ref", artifactId: "art_missing" }],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );

    expect(envelopes.map(labelEnvelope)).toEqual([
      "ack",
      "session.statusChanged",
      "message.created",
      "message.failed",
      "session.statusChanged",
      "error",
    ]);
    expect(envelopes.find((envelope) => labelEnvelope(envelope) === "message.failed")).toMatchObject({
      payload: {
        sessionId: created.session.id,
        error: {
          code: "UNSUPPORTED_MESSAGE_PART",
        },
      },
    });

    const snapshot = await jsonFetch<{ session: { status: string } }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}`);
    expect(snapshot.session.status).toBe("error");
  }, 20_000);

  it("sanitizes OpenCode prompt failures before publishing them to the frontend", async () => {
    const fakeOpenCode = await startFakeOpenCode({ failPrompt: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-runtime-failure" }),
    });

    const envelopes = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_runtime_failure",
        command: "session.sendMessage",
        payload: {
          sessionId: created.session.id,
          parts: [{ type: "text", text: "Trigger provider failure" }],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );

    expect(envelopes.map(labelEnvelope)).toEqual([
      "ack",
      "session.statusChanged",
      "message.created",
      "message.failed",
      "session.statusChanged",
      "error",
    ]);
    expect(envelopes.find((envelope) => labelEnvelope(envelope) === "message.failed")).toMatchObject({
      payload: {
        error: {
          code: "OPENCODE_RUNTIME_ERROR",
          message: "OpenCode runtime request failed",
        },
      },
    });
    expect(envelopes.find((envelope) => labelEnvelope(envelope) === "error")).toMatchObject({
      code: "OPENCODE_RUNTIME_ERROR",
      message: "OpenCode runtime request failed",
    });
    expect(JSON.stringify(envelopes)).not.toContain("secret-provider-detail");
    expect(JSON.stringify(envelopes)).not.toContain("ProviderAuthError");
    expect(JSON.stringify(envelopes)).not.toContain("deepseek");
  }, 20_000);

  it("normalizes runtime message errors in HTTP snapshots", async () => {
    const fakeOpenCode = await startFakeOpenCode({ includeErrorMessage: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-message-error" }),
    });

    const listed = await jsonFetch<{ messages: Array<Record<string, unknown>> }>(
      `${adapter.baseUrl}/v1/sessions/${created.session.id}/messages`,
    );

    expect(listed.messages[0]).toMatchObject({
      status: "error",
      error: {
        code: "PROVIDER_AUTH_ERROR",
        message: "Model provider authentication failed",
      },
    });
    expect(JSON.stringify(listed)).not.toContain("secret-provider-detail");
    expect(JSON.stringify(listed)).not.toContain("ProviderAuthError");
    expect(JSON.stringify(listed)).not.toContain("deepseek");
  }, 20_000);

  it("returns RUNTIME_UNAVAILABLE when OpenCode health is offline", async () => {
    const adapter = await startAdapter(await getFreePort());
    const response = await fetch(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "offline" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  }, 20_000);

  it("normalizes OpenCode event stream updates and replays missed events", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-events" }),
    });

    const live = await collectWsEvents(
      adapter.wsUrl,
      () => {
        fakeOpenCode.emitEvent({
          type: "session.status",
          properties: { sessionID: fakeOpenCode.runtimeSessionId, status: { type: "busy" } },
        });
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            delta: "hel",
            part: {
              id: "runtime_text_part_private",
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "text",
              text: "hel",
            },
          },
        });
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "runtime_tool_part_private",
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "tool",
              callID: "runtime_call_private",
              tool: "bash",
              state: { status: "running", title: "Run command", input: {}, raw: "" },
            },
          },
        });
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "runtime_tool_part_private",
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "tool",
              callID: "runtime_call_private",
              tool: "bash",
              state: { status: "completed", title: "Run command", output: "done", input: {}, metadata: {}, time: { start: 1, end: 2 } },
            },
          },
        });
        fakeOpenCode.emitEvent({
          type: "permission.updated",
          properties: {
            id: "runtime_permission_private",
            type: "shell",
            sessionID: fakeOpenCode.runtimeSessionId,
            messageID: fakeOpenCode.runtimeMessageId,
            title: "Run shell command",
            metadata: { command: "echo hi", nested: { raw: "ignored" } },
            time: { created: Date.now() },
          },
        });
      },
      5,
    );

    expect(live.map(labelEnvelope)).toEqual([
      "session.statusChanged",
      "message.delta",
      "tool.started",
      "tool.completed",
      "permission.requested",
    ]);
    expect(live[1]).toMatchObject({
      name: "message.delta",
      payload: {
        sessionId: created.session.id,
        messageId: expect.stringMatching(/^msg_/),
        partId: expect.stringMatching(/^part_/),
        delta: "hel",
        part: { type: "text", text: "hel" },
      },
    });
    expect(live.find((event) => event.name === "tool.completed")).toMatchObject({
      payload: {
        sessionId: created.session.id,
        toolStepId: expect.stringMatching(/^tool_/),
        tool: "bash",
        output: "done",
      },
    });
    expect(live.find((event) => event.name === "permission.requested")).toMatchObject({
      payload: {
        permission: {
          id: expect.stringMatching(/^perm_/),
          sessionId: created.session.id,
          type: "shell",
          title: "Run shell command",
          status: "pending",
        },
      },
    });
    expect(JSON.stringify(live)).not.toContain(fakeOpenCode.runtimeSessionId);
    expect(JSON.stringify(live)).not.toContain(fakeOpenCode.runtimeMessageId);
    expect(JSON.stringify(live)).not.toContain("runtime_permission_private");
    expect(JSON.stringify(live)).not.toContain("runtime_call_private");

    const replayed = await collectWsEvents(`${adapter.wsUrl}?lastEventId=${live[0].eventId}`, undefined, 4);
    expect(replayed.map(labelEnvelope)).toEqual(live.slice(1).map(labelEnvelope));
    expect(fakeOpenCode.eventRequestUrls.some((url) => url.includes("directory="))).toBe(true);
  }, 20_000);

  it("requires a snapshot refresh when the replay cursor is unknown", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);

    const envelopes = await collectWsEnvelopes(`${adapter.wsUrl}?lastEventId=evt_missing`, undefined, 1);

    expect(envelopes).toEqual([
      expect.objectContaining({
        type: "error",
        code: "EVENT_REPLAY_UNAVAILABLE",
      }),
    ]);
  }, 20_000);

  it("reconnects the OpenCode event stream after disconnect", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-reconnect" }),
    });

    const live = await collectWsEvents(
      adapter.wsUrl,
      () => {
        fakeOpenCode.closeEventStreams();
        setTimeout(() => {
          fakeOpenCode.emitEvent({
            type: "session.status",
            properties: { sessionID: fakeOpenCode.runtimeSessionId, status: { type: "busy" } },
          });
        }, 900);
      },
      2,
    );

    expect(live.map(labelEnvelope)).toEqual(["runtime.statusChanged", "session.statusChanged"]);
    expect(live[0]).toMatchObject({
      payload: {
        status: "disconnected",
      },
    });
    expect(fakeOpenCode.eventRequestUrls.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("does not duplicate message.completed when OpenCode emits message.updated during prompt", async () => {
    const fakeOpenCode = await startFakeOpenCode({ emitCompletedDuringPrompt: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-no-duplicate-completion" }),
    });

    const envelopes = await sendWsCommand(adapter.wsUrl, {
      type: "command",
      requestId: "req_no_duplicate_completion",
      command: "session.sendMessage",
      payload: {
        sessionId: created.session.id,
        parts: [{ type: "text", text: "Reply exactly: OK" }],
      },
    });

    expect(envelopes.map(labelEnvelope).filter((label) => label === "message.completed")).toHaveLength(1);
  }, 20_000);

  it("approves, stores, auto-applies, and revokes permission scopes", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-permission" }),
    });

    const requested = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_private_1", command: "echo hi" }),
    );
    const permissionId = ((requested.payload as { permission: { id: string } }).permission.id);

    const approved = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_permission_approve",
        command: "permission.respond",
        payload: { permissionId, decision: "approve", scope: "project" },
      },
      (next) => labelEnvelope(next) === "permission.resolved",
    );

    expect(approved.map(labelEnvelope)).toEqual(["ack", "permission.resolved"]);
    expect(fakeOpenCode.permissionReplies).toEqual([{ permissionId: "runtime_permission_private_1", response: "always" }]);

    const settings = await jsonFetch<{ permissions: unknown[]; grants: Array<{ status: string; scope: string }> }>(`${adapter.baseUrl}/v1/permissions`);
    expect(settings.grants).toContainEqual(expect.objectContaining({ status: "active", scope: "project" }));

    const autoResolved = await collectPermissionEvent(
      adapter.wsUrl,
      () => fakeOpenCode.emitPermission({ id: "runtime_permission_private_2", command: "echo hi" }),
      "permission.resolved",
    );
    expect(autoResolved).toMatchObject({
      payload: {
        permission: {
          status: "approved",
          grantedScope: "project",
        },
      },
    });
    expect(fakeOpenCode.permissionReplies).toEqual([
      { permissionId: "runtime_permission_private_1", response: "always" },
      { permissionId: "runtime_permission_private_2", response: "always" },
    ]);
    expect(JSON.stringify(autoResolved)).not.toContain("runtime_permission_private_2");

    const revoked = await jsonFetch<{ permission: { status: string; revokedAt?: string } }>(`${adapter.baseUrl}/v1/permissions/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionId }),
    });
    expect(revoked.permission).toMatchObject({ status: "revoked" });
    expect(revoked.permission.revokedAt).toEqual(expect.any(String));

    const requestedAfterRevoke = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_private_3", command: "echo hi" }),
    );
    expect(requestedAfterRevoke).toMatchObject({
      payload: {
        permission: {
          status: "pending",
          type: "shell",
          title: "Run shell command",
        },
      },
    });
    expect(fakeOpenCode.permissionReplies).toHaveLength(2);
  }, 20_000);

  it("revokes the underlying grant when an auto-approved permission is revoked", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-permission-auto-revoke" }),
    });

    const requested = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_auto_origin", command: "echo hi" }),
    );
    const permissionId = ((requested.payload as { permission: { id: string } }).permission.id);
    await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_permission_auto_origin_approve",
        command: "permission.respond",
        payload: { permissionId, decision: "approve", scope: "project" },
      },
      (next) => labelEnvelope(next) === "permission.resolved",
    );

    const autoResolved = await collectPermissionEvent(
      adapter.wsUrl,
      () => fakeOpenCode.emitPermission({ id: "runtime_permission_auto_applied", command: "echo hi" }),
      "permission.resolved",
    );
    const autoPermissionId = ((autoResolved.payload as { permission: { id: string } }).permission.id);
    await jsonFetch<{ permission: { status: string } }>(`${adapter.baseUrl}/v1/permissions/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ permissionId: autoPermissionId }),
    });

    const requestedAfterAutoRevoke = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_after_auto_revoke", command: "echo hi" }),
    );
    expect(requestedAfterAutoRevoke).toMatchObject({
      payload: {
        permission: {
          status: "pending",
        },
      },
    });
    expect(fakeOpenCode.permissionReplies).toEqual([
      { permissionId: "runtime_permission_auto_origin", response: "always" },
      { permissionId: "runtime_permission_auto_applied", response: "always" },
    ]);
  }, 20_000);

  it("approves without scope as once and does not create a grant", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-permission-once" }),
    });
    const requested = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_once", command: "date" }),
    );
    const permissionId = ((requested.payload as { permission: { id: string } }).permission.id);

    const approved = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_permission_once",
        command: "permission.respond",
        payload: { permissionId, decision: "approve" },
      },
      (next) => labelEnvelope(next) === "permission.resolved",
    );

    expect(approved.find((event) => labelEnvelope(event) === "permission.resolved")).toMatchObject({
      payload: {
        permission: {
          status: "approved",
          grantedScope: "once",
        },
      },
    });
    expect(fakeOpenCode.permissionReplies).toEqual([{ permissionId: "runtime_permission_once", response: "once" }]);
    const permissions = await jsonFetch<{ grants: unknown[] }>(`${adapter.baseUrl}/v1/permissions`);
    expect(permissions.grants).toHaveLength(0);
  }, 20_000);

  it("fails permission.respond when the runtime mapping is missing", async () => {
    const fakeOpenCode = await startFakeOpenCode({ omitPermissionId: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-permission-missing-runtime" }),
    });
    const requested = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_missing", command: "date" }),
    );
    const permissionId = ((requested.payload as { permission: { id: string } }).permission.id);

    const envelopes = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_permission_missing_runtime",
        command: "permission.respond",
        payload: { permissionId, decision: "approve" },
      },
      (next) => labelEnvelope(next) === "error",
    );

    expect(envelopes).toEqual([
      expect.objectContaining({ type: "ack" }),
      expect.objectContaining({
        type: "error",
        code: "INTERNAL_ERROR",
        message: expect.stringContaining("Permission has no runtime mapping"),
      }),
    ]);
    expect(fakeOpenCode.permissionReplies).toHaveLength(0);
  }, 20_000);

  it("denies permissions by replying reject to OpenCode", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-permission-deny" }),
    });
    const requested = await collectPermissionEvent(adapter.wsUrl, () =>
      fakeOpenCode.emitPermission({ id: "runtime_permission_deny", command: "rm file" }),
    );
    const permissionId = ((requested.payload as { permission: { id: string } }).permission.id);

    const denied = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_permission_deny",
        command: "permission.respond",
        payload: { permissionId, decision: "deny" },
      },
      (next) => labelEnvelope(next) === "permission.resolved",
    );

    expect(denied.find((event) => labelEnvelope(event) === "permission.resolved")).toMatchObject({
      payload: {
        permission: {
          status: "denied",
        },
      },
    });
    expect(fakeOpenCode.permissionReplies).toEqual([{ permissionId: "runtime_permission_deny", response: "reject" }]);
  }, 20_000);

  it("proposes, approves, records evidenced step results, and revises plans without fake execution", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-plan" }),
    });

    const proposed = await jsonFetch<{ plan: { id: string; status: string; version: number; steps: Array<{ id: string; status: string }> } }>(`${adapter.baseUrl}/v1/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.session.id,
        title: "Analyze data",
        summary: "Two step plan",
        steps: [
          { title: "Inspect inputs", description: "Read files" },
          { title: "Write summary", description: "Create output" },
        ],
      }),
    });
    const plan = proposed.plan;
    expect(plan).toMatchObject({
      id: expect.stringMatching(/^plan_/),
      status: "awaiting_approval",
      version: 1,
      steps: [{ status: "pending" }, { status: "pending" }],
    });

    const snapshot = await jsonFetch<{ plans: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/plans`);
    expect(snapshot.plans).toEqual([expect.objectContaining({ id: plan.id, status: "awaiting_approval" })]);

    const revision = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_plan_revision",
        command: "plan.requestRevision",
        payload: { planId: plan.id, message: "Split the second step" },
      },
      (next) => labelEnvelope(next) === "plan.updated",
    );
    expect(revision.map(labelEnvelope)).toEqual(["ack", "plan.updated"]);
    const revisedPlan = (revision.find((event) => labelEnvelope(event) === "plan.updated")?.payload as { plan: { id: string; version: number; supersedesPlanId: string; revisionRequest: string } }).plan;
    expect(revisedPlan).toMatchObject({
      id: expect.stringMatching(/^plan_/),
      version: 2,
      supersedesPlanId: plan.id,
      revisionRequest: "Split the second step",
    });

    const approved = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_plan_approve",
        command: "plan.approve",
        payload: { planId: revisedPlan.id },
      },
      (next) => labelEnvelope(next) === "plan.approved",
    );
    expect(approved.map(labelEnvelope)).toEqual(["ack", "plan.approved"]);
    expect(approved.find((event) => labelEnvelope(event) === "plan.approved")).toMatchObject({
      payload: {
        plan: {
          id: revisedPlan.id,
          status: "approved",
          steps: [{ status: "pending" }, { status: "pending" }],
        },
      },
    });

    const approvedSnapshot = await jsonFetch<{ plans: Array<{ id: string; status: string; supersedesPlanId?: string; steps: Array<{ id: string; status: string }> }> }>(
      `${adapter.baseUrl}/v1/sessions/${created.session.id}/plans`,
    );
    const approvedPlan = approvedSnapshot.plans.find((candidate) => candidate.id === revisedPlan.id);
    expect(approvedPlan).toMatchObject({ status: "approved", supersedesPlanId: plan.id });
    if (!approvedPlan) throw new Error("Expected approved plan snapshot");

    const firstExecutionStepId = await emitAdapterToolStep(adapter, fakeOpenCode, "Plan step 1", "first");
    const firstStepResult = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_plan_step_1",
        command: "plan.recordStepResult",
        payload: { planId: approvedPlan.id, stepId: approvedPlan.steps[0].id, executionStepIds: [firstExecutionStepId] },
      },
      (next, envelopes) => envelopes.filter((envelope) => labelEnvelope(envelope) === "plan.stepCompleted").length === 1,
    );
    expect(firstStepResult.map(labelEnvelope)).toEqual(["ack", "plan.stepStarted", "plan.stepCompleted"]);
    expect(firstStepResult.find((event) => labelEnvelope(event) === "plan.stepCompleted")).toMatchObject({
      payload: { step: { status: "completed", executionStepIds: [firstExecutionStepId] } },
    });

    const secondExecutionStepId = await emitAdapterToolStep(adapter, fakeOpenCode, "Plan step 2", "second");
    const secondStepResult = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_plan_step_2",
        command: "plan.recordStepResult",
        payload: { planId: approvedPlan.id, stepId: approvedPlan.steps[1].id, executionStepIds: [secondExecutionStepId] },
      },
      (next) => labelEnvelope(next) === "plan.completed",
    );
    expect(secondStepResult.map(labelEnvelope)).toEqual(["ack", "plan.stepStarted", "plan.stepCompleted", "plan.completed"]);
    expect(secondStepResult.find((event) => labelEnvelope(event) === "plan.completed")).toMatchObject({
      payload: { plan: { id: approvedPlan.id, status: "completed", steps: [{ status: "completed" }, { status: "completed" }] } },
    });
  }, 20_000);

  it("rejects invalid plan state transitions and unverified execution links", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-plan-invalid" }),
    });
    const proposed = await jsonFetch<{ plan: { id: string; steps: Array<{ id: string }> } }>(`${adapter.baseUrl}/v1/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, steps: [{ title: "Step" }] }),
    });

    const unknown = await sendWsCommand(
      adapter.wsUrl,
      { type: "command", requestId: "req_plan_unknown", command: "plan.approve", payload: { planId: "plan_missing" } },
      (next) => labelEnvelope(next) === "error",
    );
    expect(unknown).toContainEqual(expect.objectContaining({ type: "error", code: "NOT_FOUND" }));

    const revised = await sendWsCommand(
      adapter.wsUrl,
      { type: "command", requestId: "req_plan_revise_invalid", command: "plan.requestRevision", payload: { planId: proposed.plan.id, message: "Revise" } },
      (next) => labelEnvelope(next) === "plan.updated",
    );
    const replacement = (revised.find((event) => labelEnvelope(event) === "plan.updated")?.payload as { plan: { id: string; steps: Array<{ id: string }> } }).plan;

    const supersededApproval = await sendWsCommand(
      adapter.wsUrl,
      { type: "command", requestId: "req_plan_superseded", command: "plan.approve", payload: { planId: proposed.plan.id } },
      (next) => labelEnvelope(next) === "error",
    );
    expect(supersededApproval).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));

    await sendWsCommand(
      adapter.wsUrl,
      { type: "command", requestId: "req_plan_approve_once", command: "plan.approve", payload: { planId: replacement.id } },
      (next) => labelEnvelope(next) === "plan.approved",
    );
    const duplicateApproval = await sendWsCommand(
      adapter.wsUrl,
      { type: "command", requestId: "req_plan_approve_twice", command: "plan.approve", payload: { planId: replacement.id } },
      (next) => labelEnvelope(next) === "error",
    );
    expect(duplicateApproval).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));

    const revisionAfterApproval = await sendWsCommand(
      adapter.wsUrl,
      { type: "command", requestId: "req_plan_revise_after_approval", command: "plan.requestRevision", payload: { planId: replacement.id, message: "Too late" } },
      (next) => labelEnvelope(next) === "error",
    );
    expect(revisionAfterApproval).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));

    const rawStepResponse = await fetch(`${adapter.baseUrl}/v1/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, steps: [{ title: "Bad", executionStepIds: [fakeOpenCode.runtimeMessageId] }] }),
    });
    expect(rawStepResponse.status).toBe(500);
    await expect(rawStepResponse.text()).resolves.not.toContain(fakeOpenCode.runtimeMessageId);

    const missingStepResult = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_plan_missing_step_result",
        command: "plan.recordStepResult",
        payload: { planId: replacement.id, stepId: replacement.steps[0].id, executionStepIds: ["tool_missing"] },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(missingStepResult).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));

    const runningExecutionStepId = await emitAdapterToolStep(adapter, fakeOpenCode, "Running plan evidence", "still running", "running");
    const runningStepResult = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_plan_running_step_result",
        command: "plan.recordStepResult",
        payload: { planId: replacement.id, stepId: replacement.steps[0].id, executionStepIds: [runningExecutionStepId] },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(runningStepResult).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));
  }, 20_000);

  it("registers, versions, downloads, renames, stars, and deletes artifacts", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-artifact" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "result.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Result v1\n");
    const sourceMessageId = await emitAdapterTextMessage(adapter, fakeOpenCode);

    const first = await jsonFetch<{ artifact: { id: string; currentVersionId: string; kind: string; name: string }; version: { id: string; version: number; sourceMessageIds: string[] }; created: boolean }>(
      `${adapter.baseUrl}/v1/artifacts/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: created.session.id, path: artifactPath, sourceMessageIds: [sourceMessageId] }),
      },
    );

    expect(first.created).toBe(true);
    expect(first.artifact).toMatchObject({
      id: expect.stringMatching(/^art_/),
      kind: "markdown",
      name: "result.md",
      currentVersionId: first.version.id,
    });
    expect(first.version).toMatchObject({
      id: expect.stringMatching(/^ver_/),
      version: 1,
      sourceMessageIds: [sourceMessageId],
    });
    expect(first.version).not.toHaveProperty("path");
    await expect(fs.promises.access(path.join(process.cwd(), ".adapter-artifacts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.promises.access(adapter.storageRoot)).resolves.toBeUndefined();

    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Result v2\n");
    const second = await jsonFetch<{ artifact: { id: string; currentVersionId: string }; version: { id: string; version: number }; created: boolean }>(
      `${adapter.baseUrl}/v1/artifacts/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: created.session.id, path: artifactPath }),
      },
    );
    expect(second.created).toBe(false);
    expect(second.artifact.id).toBe(first.artifact.id);
    expect(second.version.version).toBe(2);
    expect(second.artifact.currentVersionId).toBe(second.version.id);

    const opened = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_artifact_open",
        command: "artifact.open",
        payload: { artifactId: first.artifact.id, versionId: first.version.id, mode: "beside" },
      },
      (next) => labelEnvelope(next) === "artifact.opened",
    );
    expect(opened.map(labelEnvelope)).toEqual(["ack", "artifact.opened"]);
    expect(opened.find((event) => labelEnvelope(event) === "artifact.opened")).toMatchObject({
      payload: {
        artifact: { id: first.artifact.id },
        version: { id: first.version.id, version: 1 },
        mode: "beside",
      },
    });
    expect(JSON.stringify(opened)).not.toContain(".adapter-test-artifacts");

    const downloadUrl = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_artifact_download_url",
        command: "artifact.downloadUrl",
        payload: { artifactId: first.artifact.id },
      },
      (next) => labelEnvelope(next) === "artifact.downloadUrlCreated",
    );
    expect(downloadUrl.map(labelEnvelope)).toEqual(["ack", "artifact.downloadUrlCreated"]);
    expect(downloadUrl.find((event) => labelEnvelope(event) === "artifact.downloadUrlCreated")).toMatchObject({
      payload: {
        artifactId: first.artifact.id,
        versionId: second.version.id,
        downloadUrl: `/v1/artifacts/${first.artifact.id}/versions/${second.version.id}/download`,
      },
    });

    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Result v3 not registered\n");

    const versions = await jsonFetch<{ versions: Array<{ id: string; version: number }> }>(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}/versions`);
    expect(versions.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions.versions[0]).not.toHaveProperty("path");

    const firstDownload = await fetch(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}/versions/${first.version.id}/download`);
    expect(firstDownload.status).toBe(200);
    await expect(firstDownload.text()).resolves.toBe("# Result v1\n");

    const secondDownload = await fetch(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}/versions/${second.version.id}/download`);
    expect(secondDownload.status).toBe(200);
    expect(secondDownload.headers.get("content-type")).toContain("text/markdown");
    await expect(secondDownload.text()).resolves.toBe("# Result v2\n");

    const starred = await jsonFetch<{ artifact: { name: string; starred: boolean } }>(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred: true }),
    });
    expect(starred.artifact).toMatchObject({ name: "result.md", starred: true });

    const patched = await jsonFetch<{ artifact: { name: string; starred: boolean } }>(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed.md" }),
    });
    expect(patched.artifact).toMatchObject({ name: "renamed.md", starred: true });

    const deleted = await jsonFetch<{ deleted: boolean }>(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}`, { method: "DELETE" });
    expect(deleted.deleted).toBe(true);
    const listed = await jsonFetch<{ artifacts: unknown[] }>(`${adapter.baseUrl}/v1/artifacts?sessionId=${created.session.id}`);
    expect(listed.artifacts).toHaveLength(0);
    const deletedVersions = await fetch(`${adapter.baseUrl}/v1/artifacts/${first.artifact.id}/versions`);
    expect(deletedVersions.status).toBe(404);
  }, 20_000);

  it("stages, discards, and commits annotations with the next message", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-annotation" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "annotated.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Annotated\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, path: artifactPath }),
    });

    const firstStage = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_stage_1",
        command: "annotation.stage",
        payload: {
          sessionId: created.session.id,
          artifactId: registered.artifact.id,
          versionId: registered.version.id,
          body: "Please clarify this heading",
          anchor: { type: "markdown", path: artifactPath, startLine: 0, endLine: 0, text: "Annotated" },
        },
      },
      (next) => labelEnvelope(next) === "annotation.staged",
    );
    const firstAnnotation = (firstStage.find((event) => labelEnvelope(event) === "annotation.staged")?.payload as { annotation: { id: string } }).annotation;

    const secondStage = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_stage_2",
        command: "annotation.stage",
        payload: {
          sessionId: created.session.id,
          artifactId: registered.artifact.id,
          versionId: registered.version.id,
          body: "Check this point",
          anchor: { type: "image_point", x: 0.4, y: 0.6, label: "interesting point" },
        },
      },
      (next) => labelEnvelope(next) === "annotation.staged",
    );
    const secondAnnotation = (secondStage.find((event) => labelEnvelope(event) === "annotation.staged")?.payload as { annotation: { id: string } }).annotation;

    const discard = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_discard",
        command: "annotation.discard",
        payload: { annotationIds: [firstAnnotation.id] },
      },
      (next) => labelEnvelope(next) === "annotation.discarded",
    );
    expect(discard).toContainEqual(
      expect.objectContaining({
        name: "annotation.discarded",
        payload: expect.objectContaining({ annotationIds: [firstAnnotation.id] }),
      }),
    );

    const send = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_send",
        command: "session.sendMessage",
        payload: {
          sessionId: created.session.id,
          parts: [{ type: "text", text: "Use the remaining annotation" }],
          annotationIds: [secondAnnotation.id],
        },
      },
      (next) => labelEnvelope(next) === "session.statusChanged" && ((next.payload as { status?: string }).status === "idle"),
    );
    expect(send.map(labelEnvelope)).toEqual([
      "ack",
      "session.statusChanged",
      "message.created",
      "annotation.committed",
      "message.completed",
      "session.statusChanged",
    ]);
    expect(send.find((event) => labelEnvelope(event) === "message.created")).toMatchObject({
      payload: {
        annotationIds: [secondAnnotation.id],
        annotations: [{ id: secondAnnotation.id, status: "staged" }],
      },
    });
    expect(send.find((event) => labelEnvelope(event) === "annotation.committed")).toMatchObject({
      payload: {
        clearedAnnotationIds: [secondAnnotation.id],
        annotations: [{ id: secondAnnotation.id, status: "committed" }],
      },
    });

    const snapshot = await jsonFetch<{ annotations: Array<{ id: string; status: string }>; staged: unknown[] }>(
      `${adapter.baseUrl}/v1/sessions/${created.session.id}/annotations`,
    );
    expect(snapshot.staged).toHaveLength(0);
    expect(snapshot.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstAnnotation.id, status: "discarded" }),
        expect.objectContaining({ id: secondAnnotation.id, status: "committed" }),
      ]),
    );
  }, 20_000);

  it("keeps annotation commits atomic and staged until runtime send succeeds", async () => {
    const fakeOpenCode = await startFakeOpenCode({ failPrompt: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-annotation-failure" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "annotation-failure.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Failure\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, path: artifactPath }),
    });
    const staged = await stageAnnotation(adapter, created.session.id, registered.artifact.id, registered.version.id, "Still staged", {
      type: "markdown",
      path: artifactPath,
      startLine: 0,
    });

    const failed = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_failed_send",
        command: "session.sendMessage",
        payload: {
          sessionId: created.session.id,
          parts: [{ type: "text", text: "This will fail" }],
          annotationIds: [staged.id],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(failed.map(labelEnvelope)).toContain("message.failed");
    expect(failed.map(labelEnvelope)).not.toContain("annotation.committed");
    const snapshot = await jsonFetch<{ annotations: Array<{ id: string; status: string }>; staged: Array<{ id: string }> }>(
      `${adapter.baseUrl}/v1/sessions/${created.session.id}/annotations`,
    );
    expect(snapshot.annotations).toContainEqual(expect.objectContaining({ id: staged.id, status: "staged" }));
    expect(snapshot.staged).toEqual([expect.objectContaining({ id: staged.id })]);
  }, 20_000);

  it("rejects invalid annotation ownership, lifecycle, and deleted artifact commits without partial mutation", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const firstSession = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-annotation-first" }),
    });
    const secondSession = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-annotation-second" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "annotation-ownership.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Ownership\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: firstSession.session.id, path: artifactPath }),
    });

    const crossStage = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_cross_stage",
        command: "annotation.stage",
        payload: {
          sessionId: secondSession.session.id,
          artifactId: registered.artifact.id,
          versionId: registered.version.id,
          body: "Wrong session",
          anchor: { type: "markdown", path: artifactPath },
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(crossStage).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));

    const firstAnnotation = await stageAnnotation(adapter, firstSession.session.id, registered.artifact.id, registered.version.id, "Valid", {
      type: "markdown",
      path: artifactPath,
    });
    const effectiveVersionAnnotation = await stageAnnotation(adapter, firstSession.session.id, registered.artifact.id, undefined, "Uses current version", {
      type: "code",
      path: artifactPath,
    });
    expect(effectiveVersionAnnotation.versionId).toBe(registered.version.id);

    const mixedDiscard = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_mixed_discard",
        command: "annotation.discard",
        payload: { annotationIds: [firstAnnotation.id, "ann_missing"] },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(mixedDiscard).toContainEqual(expect.objectContaining({ type: "error" }));
    let snapshot = await jsonFetch<{ annotations: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${firstSession.session.id}/annotations`);
    expect(snapshot.annotations).toContainEqual(expect.objectContaining({ id: firstAnnotation.id, status: "staged" }));

    const discarded = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_discard_for_commit",
        command: "annotation.discard",
        payload: { annotationIds: [firstAnnotation.id] },
      },
      (next) => labelEnvelope(next) === "annotation.discarded",
    );
    expect(discarded.map(labelEnvelope)).toEqual(["ack", "annotation.discarded"]);

    const discardedCommit = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_discarded_commit",
        command: "session.sendMessage",
        payload: {
          sessionId: firstSession.session.id,
          parts: [{ type: "text", text: "Cannot commit discarded annotation" }],
          annotationIds: [firstAnnotation.id],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(discardedCommit).toContainEqual(expect.objectContaining({ type: "error" }));

    await jsonFetch<{ deleted: boolean }>(`${adapter.baseUrl}/v1/artifacts/${registered.artifact.id}`, { method: "DELETE" });
    const deletedCommit = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_deleted_commit",
        command: "session.sendMessage",
        payload: {
          sessionId: firstSession.session.id,
          parts: [{ type: "text", text: "Cannot commit deleted artifact annotation" }],
          annotationIds: [effectiveVersionAnnotation.id],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(deletedCommit).toContainEqual(expect.objectContaining({ type: "error" }));
    snapshot = await jsonFetch<{ annotations: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${firstSession.session.id}/annotations`);
    expect(snapshot.annotations).toContainEqual(expect.objectContaining({ id: effectiveVersionAnnotation.id, status: "staged" }));
  }, 20_000);

  it("revalidates annotation artifacts after runtime send before committing", async () => {
    const fakeOpenCode = await startFakeOpenCode({ delayPromptMs: 250 });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-annotation-race" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "annotation-race.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Race\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, path: artifactPath }),
    });
    const annotation = await stageAnnotation(adapter, created.session.id, registered.artifact.id, registered.version.id, "Race annotation", {
      type: "markdown",
      path: artifactPath,
    });

    const sent = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_annotation_race_send",
        command: "session.sendMessage",
        payload: {
          sessionId: created.session.id,
          parts: [{ type: "text", text: "Race commit" }],
          annotationIds: [annotation.id],
        },
      },
      (next, envelopes) => {
        if (labelEnvelope(next) === "message.created") {
          void fetch(`${adapter.baseUrl}/v1/artifacts/${registered.artifact.id}`, { method: "DELETE" });
        }
        return labelEnvelope(next) === "error";
      },
    );
    expect(sent.map(labelEnvelope)).not.toContain("annotation.committed");
    expect(sent).toContainEqual(expect.objectContaining({ type: "error" }));
    const snapshot = await jsonFetch<{ annotations: Array<{ id: string; status: string }>; staged: Array<{ id: string }> }>(
      `${adapter.baseUrl}/v1/sessions/${created.session.id}/annotations`,
    );
    expect(snapshot.annotations).toContainEqual(expect.objectContaining({ id: annotation.id, status: "staged" }));
    expect(snapshot.staged).toEqual([expect.objectContaining({ id: annotation.id })]);
  }, 20_000);

  it("runs reviewer records, emits findings, and attaches artifact review provenance", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-reviewer" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "reviewed.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Reviewed\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, path: artifactPath, provenance: { review: [{ type: "not_run", reason: "Reviewer not requested" }] } }),
    });
    const transcriptMessageId = await emitAdapterTextMessage(adapter, fakeOpenCode);
    const secondTranscriptMessageId = await emitAdapterTextMessage(adapter, {
      ...fakeOpenCode,
      runtimeMessageId: "runtime_message_private_second_review",
    });

    const reviewed = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_run",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          artifactId: registered.artifact.id,
          versionId: registered.version.id,
          findings: [
            {
              severity: "warning",
              claim: "The summary mentions a result",
              evidence: "No execution log supports the claim",
              transcriptUrl: `#${transcriptMessageId}`,
              provenanceUrl: `/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "review.completed",
    );
    expect(reviewed.map(labelEnvelope)).toEqual(["ack", "review.started", "review.findings", "review.completed"]);
    expect(reviewed.find((event) => labelEnvelope(event) === "review.findings")).toMatchObject({
      payload: {
        findings: [
          {
            id: expect.stringMatching(/^finding_/),
            severity: "warning",
            claim: "The summary mentions a result",
            evidence: "No execution log supports the claim",
          },
        ],
      },
    });

    const provenance = await jsonFetch<{ completeness: { review: { status: string } }; tabs: { review: Array<{ type: string; findingId: string; severity: string; transcriptUrl: string; provenanceUrl: string }> } }>(
      `${adapter.baseUrl}/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`,
    );
    expect(provenance.completeness.review.status).toBe("linked");
    expect(provenance.tabs.review).toEqual([
      expect.objectContaining({
        type: "finding",
        findingId: expect.stringMatching(/^finding_/),
        severity: "warning",
        transcriptUrl: `#${transcriptMessageId}`,
        provenanceUrl: `/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`,
      }),
    ]);

    await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_run_second",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          artifactId: registered.artifact.id,
          versionId: registered.version.id,
          findings: [
            {
              severity: "info",
              claim: "Second review claim",
              evidence: "Second review evidence",
              transcriptUrl: `#${secondTranscriptMessageId}`,
              provenanceUrl: `/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "review.completed",
    );
    const repeatedProvenance = await jsonFetch<{ tabs: { review: Array<{ transcriptUrl: string }> } }>(
      `${adapter.baseUrl}/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`,
    );
    expect(repeatedProvenance.tabs.review.map((finding) => finding.transcriptUrl)).toEqual([`#${transcriptMessageId}`, `#${secondTranscriptMessageId}`]);

    const snapshot = await jsonFetch<{ reviews: Array<{ id: string; status: string; findings: unknown[] }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/reviews`);
    expect(snapshot.reviews).toHaveLength(2);
    expect(snapshot.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ status: "completed", findings: [expect.any(Object)] })]));
  }, 20_000);

  it("reports reviewer failures and rejects cross-session artifact review targets", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const firstSession = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-reviewer-first" }),
    });
    const secondSession = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-reviewer-second" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "reviewer-cross.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Cross\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: firstSession.session.id, path: artifactPath }),
    });

    const failed = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_failed",
        command: "reviewer.run",
        payload: { sessionId: firstSession.session.id, failReason: "Reviewer service unavailable" },
      },
      (next) => labelEnvelope(next) === "review.completed",
    );
    expect(failed.map(labelEnvelope)).toEqual(["ack", "review.started", "review.completed"]);
    expect(failed.find((event) => labelEnvelope(event) === "review.completed")).toMatchObject({
      payload: { status: "failed", error: "Reviewer service unavailable", review: { status: "failed" } },
    });

    const crossSession = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_cross_session",
        command: "reviewer.run",
        payload: {
          sessionId: secondSession.session.id,
          artifactId: registered.artifact.id,
          versionId: registered.version.id,
          findings: [
            {
              severity: "info",
              claim: "No issue",
              evidence: "Cross session should fail first",
              transcriptUrl: "#msg_missing",
              provenanceUrl: `/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(crossSession).toContainEqual(expect.objectContaining({ type: "error", code: "INTERNAL_ERROR" }));
  }, 20_000);

  it("rejects reviewer runs without explicit linked findings and session-owned artifacts", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-reviewer-invalid" }),
    });
    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "reviewer-sessionless.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Sessionless\n");
    const sessionless = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: artifactPath }),
    });

    const noFindings = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_no_findings",
        command: "reviewer.run",
        payload: { sessionId: created.session.id },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(noFindings).toContainEqual(expect.objectContaining({ type: "error" }));

    const missingLinks = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_missing_links",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          findings: [{ severity: "warning", claim: "Missing links", evidence: "Schema should reject this" }],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(missingLinks).toContainEqual(expect.objectContaining({ type: "error" }));

    const unknownTranscript = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_unknown_transcript",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          findings: [
            {
              severity: "warning",
              claim: "Unknown transcript",
              evidence: "The link points nowhere",
              transcriptUrl: "#msg_missing",
              provenanceUrl: `/v1/sessions/${created.session.id}/reviews`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(unknownTranscript).toContainEqual(expect.objectContaining({ type: "error" }));

    const transcriptMessageId = await emitAdapterTextMessage(adapter, fakeOpenCode);
    const wrongProvenance = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_wrong_provenance",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          findings: [
            {
              severity: "warning",
              claim: "Wrong provenance",
              evidence: "The link points to the wrong surface",
              transcriptUrl: `#${transcriptMessageId}`,
              provenanceUrl: "/v1/artifacts/art_wrong/versions/ver_wrong/provenance",
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(wrongProvenance).toContainEqual(expect.objectContaining({ type: "error" }));

    const sessionReviewed = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_session_success",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          findings: [
            {
              severity: "info",
              claim: "Session review claim",
              evidence: "Session review evidence",
              transcriptUrl: `#${transcriptMessageId}`,
              provenanceUrl: `/v1/sessions/${created.session.id}/reviews`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "review.completed",
    );
    expect(sessionReviewed.map(labelEnvelope)).toEqual(["ack", "review.started", "review.findings", "review.completed"]);

    const automatic = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_automatic",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          mode: "automatic",
          findings: [
            {
              severity: "info",
              claim: "Automatic should not fake success",
              evidence: "No reviewer service is connected",
              transcriptUrl: `#${transcriptMessageId}`,
              provenanceUrl: `/v1/sessions/${created.session.id}/reviews`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(automatic).toContainEqual(expect.objectContaining({ type: "error", code: "COMMAND_NOT_IMPLEMENTED" }));

    const sessionlessTarget = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_reviewer_sessionless",
        command: "reviewer.run",
        payload: {
          sessionId: created.session.id,
          artifactId: sessionless.artifact.id,
          versionId: sessionless.version.id,
          findings: [
            {
              severity: "info",
              claim: "Sessionless artifact should not be reviewable as session-owned",
              evidence: "Artifact lacks session owner",
              transcriptUrl: "#msg",
              provenanceUrl: `/v1/artifacts/${sessionless.artifact.id}/versions/${sessionless.version.id}/provenance`,
            },
          ],
        },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(sessionlessTarget).toContainEqual(expect.objectContaining({ type: "error" }));
  }, 20_000);

  it("tracks delegation state and remote job lifecycle without fake completion", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-delegation" }),
    });

    const spawned = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_track_spawn",
        command: "track.spawn",
        payload: {
          sessionId: created.session.id,
          title: "Review dataset",
          agentKind: "reviewer",
          transcriptUrl: `/v1/sessions/${created.session.id}/tracks/review-dataset`,
        },
      },
      (next) => labelEnvelope(next) === "track.statusChanged",
    );
    expect(spawned.map(labelEnvelope)).toEqual(["ack", "track.created", "track.statusChanged"]);
    const track = (spawned.find((event) => labelEnvelope(event) === "track.created")?.payload as { track: { id: string; status: string } }).track;
    expect(track).toMatchObject({ id: expect.stringMatching(/^track_/), status: "running" });

    const child = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_child_track_spawn",
        command: "track.spawn",
        payload: {
          sessionId: created.session.id,
          parentTrackId: track.id,
          title: "Child analysis",
        },
      },
      (next) => labelEnvelope(next) === "track.statusChanged",
    );
    const childTrack = (child.find((event) => labelEnvelope(event) === "track.created")?.payload as { track: { id: string; parentTrackId: string } }).track;
    expect(childTrack.parentTrackId).toBe(track.id);

    const updated = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_track_update",
        command: "track.update",
        payload: { trackId: track.id, status: "blocked", message: "Waiting on remote job" },
      },
      (next) => labelEnvelope(next) === "track.message",
    );
    expect(updated.map(labelEnvelope)).toEqual(["ack", "track.statusChanged", "track.message"]);

    const submitted = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_remote_job_submit",
        command: "remoteJob.submit",
        payload: {
          sessionId: created.session.id,
          trackId: track.id,
          provider: "external-hpc",
          title: "Run simulation",
          command: "python simulate.py",
        },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    expect(submitted.map(labelEnvelope)).toEqual(["ack", "remoteJob.submitted", "remoteJob.statusChanged"]);
    const job = (submitted.find((event) => labelEnvelope(event) === "remoteJob.submitted")?.payload as { job: { id: string; status: string } }).job;
    expect(job).toMatchObject({ id: expect.stringMatching(/^rjob_/), status: "queued" });

    const log = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_remote_job_log",
        command: "remoteJob.appendLog",
        payload: { jobId: job.id, stream: "stdout", text: "started\n" },
      },
      (next) => labelEnvelope(next) === "remoteJob.logAppended",
    );
    expect(log.find((event) => labelEnvelope(event) === "remoteJob.logAppended")).toMatchObject({
      payload: { jobId: job.id, log: { stream: "stdout", text: "started\n" } },
    });

    const running = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_remote_job_running",
        command: "remoteJob.update",
        payload: { jobId: job.id, status: "running", externalUrl: "https://jobs.example/run/1" },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    expect(running.find((event) => labelEnvelope(event) === "remoteJob.statusChanged")).toMatchObject({
      payload: { status: "running", job: { externalUrl: "https://jobs.example/run/1" } },
    });

    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "remote-job-output.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Remote job output\n");
    const artifact = await jsonFetch<{ artifact: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, path: artifactPath }),
    });

    const succeeded = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_remote_job_success",
        command: "remoteJob.update",
        payload: { jobId: job.id, status: "succeeded", artifactIds: [artifact.artifact.id] },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    expect(succeeded.find((event) => labelEnvelope(event) === "remoteJob.statusChanged")).toMatchObject({
      payload: { status: "succeeded", job: { artifactIds: [artifact.artifact.id] } },
    });

    const completed = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_track_complete",
        command: "track.update",
        payload: { trackId: track.id, status: "completed", message: "Remote job finished" },
      },
      (next) => labelEnvelope(next) === "track.completed",
    );
    expect(completed.map(labelEnvelope)).toEqual(["ack", "track.statusChanged", "track.message", "track.completed"]);

    const tracks = await jsonFetch<{ tracks: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/tracks`);
    expect(tracks.tracks).toEqual(expect.arrayContaining([expect.objectContaining({ id: track.id, status: "completed" }), expect.objectContaining({ id: childTrack.id, status: "running" })]));
    const jobs = await jsonFetch<{ jobs: Array<{ id: string; status: string; logs: unknown[]; artifactIds: string[] }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/remote-jobs`);
    expect(jobs.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ id: job.id, status: "succeeded", logs: [expect.any(Object)], artifactIds: [artifact.artifact.id] })]));
  }, 25_000);

  it("stops active tracks and remote jobs when the session stops", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-stop-fanout" }),
    });
    const spawned = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_stop_track_spawn",
        command: "track.spawn",
        payload: { sessionId: created.session.id, title: "Active track" },
      },
      (next) => labelEnvelope(next) === "track.statusChanged",
    );
    const track = (spawned.find((event) => labelEnvelope(event) === "track.created")?.payload as { track: { id: string } }).track;
    const submitted = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_stop_job_submit",
        command: "remoteJob.submit",
        payload: { sessionId: created.session.id, trackId: track.id, provider: "external-hpc", title: "Active job" },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    const job = (submitted.find((event) => labelEnvelope(event) === "remoteJob.submitted")?.payload as { job: { id: string } }).job;

    const stopped = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_session_stop_fanout",
        command: "session.stop",
        payload: { sessionId: created.session.id },
      },
      (next) => labelEnvelope(next) === "session.statusChanged",
    );
    expect(stopped.map(labelEnvelope)).toEqual(["ack", "track.statusChanged", "track.completed", "remoteJob.statusChanged", "session.statusChanged"]);
    expect(stopped.find((event) => labelEnvelope(event) === "track.statusChanged")).toMatchObject({ payload: { status: "cancelled", track: { id: track.id } } });
    expect(stopped.find((event) => labelEnvelope(event) === "remoteJob.statusChanged")).toMatchObject({ payload: { status: "cancelled", job: { id: job.id } } });

    const tracks = await jsonFetch<{ tracks: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/tracks`);
    expect(tracks.tracks).toContainEqual(expect.objectContaining({ id: track.id, status: "cancelled" }));
    const jobs = await jsonFetch<{ jobs: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/remote-jobs`);
    expect(jobs.jobs).toContainEqual(expect.objectContaining({ id: job.id, status: "cancelled" }));
  }, 25_000);

  it("rejects cross-session delegation links and terminal remote work mutation", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const first = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-delegation-first" }),
    });
    const second = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-delegation-second" }),
    });
    const spawned = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_invalid_track_spawn",
        command: "track.spawn",
        payload: { sessionId: first.session.id, title: "First track" },
      },
      (next) => labelEnvelope(next) === "track.statusChanged",
    );
    const track = (spawned.find((event) => labelEnvelope(event) === "track.created")?.payload as { track: { id: string } }).track;

    const crossParent = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_cross_parent_track",
        command: "track.spawn",
        payload: { sessionId: second.session.id, parentTrackId: track.id, title: "Invalid child" },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(crossParent).toContainEqual(expect.objectContaining({ type: "error" }));

    const crossJobTrack = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_cross_job_track",
        command: "remoteJob.submit",
        payload: { sessionId: second.session.id, trackId: track.id, provider: "external-hpc", title: "Invalid job" },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(crossJobTrack).toContainEqual(expect.objectContaining({ type: "error" }));

    const submitted = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_terminal_job_submit",
        command: "remoteJob.submit",
        payload: { sessionId: first.session.id, trackId: track.id, provider: "external-hpc", title: "Terminal job" },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    const job = (submitted.find((event) => labelEnvelope(event) === "remoteJob.submitted")?.payload as { job: { id: string } }).job;

    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "cross-job-artifact.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Cross job artifact\n");
    const crossArtifact = await jsonFetch<{ artifact: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: second.session.id, path: artifactPath }),
    });

    const crossArtifactUpdate = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_cross_job_artifact",
        command: "remoteJob.update",
        payload: { jobId: job.id, status: "succeeded", artifactIds: [crossArtifact.artifact.id] },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(crossArtifactUpdate).toContainEqual(expect.objectContaining({ type: "error" }));

    await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_terminal_job_cancel",
        command: "remoteJob.update",
        payload: { jobId: job.id, status: "cancelled" },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    const terminalJobUpdate = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_terminal_job_update",
        command: "remoteJob.update",
        payload: { jobId: job.id, status: "running" },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(terminalJobUpdate).toContainEqual(expect.objectContaining({ type: "error" }));

    const terminalJobLog = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_terminal_job_log",
        command: "remoteJob.appendLog",
        payload: { jobId: job.id, stream: "system", text: "late log" },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(terminalJobLog).toContainEqual(expect.objectContaining({ type: "error" }));

    await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_terminal_track_cancel",
        command: "track.stop",
        payload: { trackId: track.id },
      },
      (next) => labelEnvelope(next) === "track.completed",
    );
    const terminalTrackUpdate = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_terminal_track_update",
        command: "track.update",
        payload: { trackId: track.id, status: "running" },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(terminalTrackUpdate).toContainEqual(expect.objectContaining({ type: "error" }));
  }, 25_000);

  it("cancels adapter-owned work even when runtime stop fails", async () => {
    const fakeOpenCode = await startFakeOpenCode({ failAbort: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-stop-runtime-failure" }),
    });
    const spawned = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_stop_failure_track_spawn",
        command: "track.spawn",
        payload: { sessionId: created.session.id, title: "Runtime failure track" },
      },
      (next) => labelEnvelope(next) === "track.statusChanged",
    );
    const track = (spawned.find((event) => labelEnvelope(event) === "track.created")?.payload as { track: { id: string } }).track;
    const submitted = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_stop_failure_job_submit",
        command: "remoteJob.submit",
        payload: { sessionId: created.session.id, trackId: track.id, provider: "external-hpc", title: "Runtime failure job" },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    const job = (submitted.find((event) => labelEnvelope(event) === "remoteJob.submitted")?.payload as { job: { id: string } }).job;

    const stopped = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_session_stop_runtime_failure",
        command: "session.stop",
        payload: { sessionId: created.session.id },
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(stopped.map(labelEnvelope)).toEqual(["ack", "track.statusChanged", "track.completed", "remoteJob.statusChanged", "session.statusChanged", "error"]);
    expect(stopped.find((event) => labelEnvelope(event) === "track.statusChanged")).toMatchObject({ payload: { status: "cancelled", track: { id: track.id } } });
    expect(stopped.find((event) => labelEnvelope(event) === "remoteJob.statusChanged")).toMatchObject({ payload: { status: "cancelled", job: { id: job.id } } });
    expect(stopped.find((event) => labelEnvelope(event) === "session.statusChanged")).toMatchObject({ payload: { status: "stopped" } });

    const tracks = await jsonFetch<{ tracks: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/tracks`);
    expect(tracks.tracks).toContainEqual(expect.objectContaining({ id: track.id, status: "cancelled" }));
    const jobs = await jsonFetch<{ jobs: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/remote-jobs`);
    expect(jobs.jobs).toContainEqual(expect.objectContaining({ id: job.id, status: "cancelled" }));
  }, 25_000);

  it("cancels adapter-owned work through HTTP stop even when runtime stop fails", async () => {
    const fakeOpenCode = await startFakeOpenCode({ failAbort: true });
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-http-stop-runtime-failure" }),
    });
    const spawned = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_http_stop_failure_track_spawn",
        command: "track.spawn",
        payload: { sessionId: created.session.id, title: "HTTP stop failure track" },
      },
      (next) => labelEnvelope(next) === "track.statusChanged",
    );
    const track = (spawned.find((event) => labelEnvelope(event) === "track.created")?.payload as { track: { id: string } }).track;
    const submitted = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_http_stop_failure_job_submit",
        command: "remoteJob.submit",
        payload: { sessionId: created.session.id, trackId: track.id, provider: "external-hpc", title: "HTTP stop failure job" },
      },
      (next) => labelEnvelope(next) === "remoteJob.statusChanged",
    );
    const job = (submitted.find((event) => labelEnvelope(event) === "remoteJob.submitted")?.payload as { job: { id: string } }).job;

    const response = await fetch(`${adapter.baseUrl}/v1/sessions/${created.session.id}/stop`, { method: "POST" });
    expect(response.status).toBe(502);

    const tracks = await jsonFetch<{ tracks: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/tracks`);
    expect(tracks.tracks).toContainEqual(expect.objectContaining({ id: track.id, status: "cancelled" }));
    const jobs = await jsonFetch<{ jobs: Array<{ id: string; status: string }> }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}/remote-jobs`);
    expect(jobs.jobs).toContainEqual(expect.objectContaining({ id: job.id, status: "cancelled" }));
    const stoppedSession = await jsonFetch<{ session: { id: string; status: string } }>(`${adapter.baseUrl}/v1/sessions/${created.session.id}`);
    expect(stoppedSession.session.status).toBe("stopped");
  }, 25_000);

  it("returns artifact provenance with linked execution records and explicit missing tabs", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-provenance" }),
    });

    const toolEvents = await collectWsEvents(
      adapter.wsUrl,
      () => {
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "runtime_tool_part_private",
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "tool",
              callID: "runtime_call_private_provenance",
              tool: "bash",
              state: {
                status: "completed",
                title: "Generate artifact",
                input: { command: "echo result" },
                output: "result\n",
                metadata: { exitCode: 0 },
              },
            },
          },
        });
      },
      1,
      (event) => event.name === "tool.completed",
    );
    const toolStepId = String((toolEvents[0].payload as { toolStepId: string }).toolStepId);
    const sourceMessageId = await emitAdapterTextMessage(adapter, fakeOpenCode);

    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "provenance.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Provenance\n");
    const registered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.session.id,
        path: artifactPath,
        sourceMessageIds: [sourceMessageId],
        provenance: {
          executionStepIds: [toolStepId],
          code: [{ language: "bash", content: "echo result", description: "Generate markdown output" }],
          environment: { shell: "bash", adapter: { version: "forged" }, runtime: { kind: "forged" }, artifact: { sha256: "forged" } },
          review: [{ type: "not_run", reason: "Reviewer not requested" }],
        },
      }),
    });

    const provenance = await jsonFetch<{
      status: string;
      missing: string[];
      completeness: Record<string, { status: string }>;
      tabs: {
        messages: Array<{ messageId: string }>;
        code: Array<{ language: string; content: string }>;
        executionLog: Array<{ stepId: string; kind: string; stdout: string; exitCode: number }>;
        environment: Record<string, unknown>;
        review: Array<Record<string, unknown>>;
      };
    }>(`${adapter.baseUrl}/v1/artifacts/${registered.artifact.id}/versions/${registered.version.id}/provenance`);

    expect(provenance.status).toBe("partial");
    expect(provenance.completeness.messages.status).toBe("linked");
    expect(provenance.completeness.code.status).toBe("linked");
    expect(provenance.completeness.executionLog.status).toBe("linked");
    expect(provenance.completeness.environment.status).toBe("partial");
    expect(provenance.completeness.review.status).toBe("missing");
    expect(provenance.missing).toEqual(["review"]);
    expect(provenance.tabs.messages).toEqual([{ messageId: sourceMessageId }]);
    expect(provenance.tabs.code).toMatchObject([{ language: "bash", content: "echo result" }]);
    expect(provenance.tabs.executionLog).toMatchObject([{ stepId: toolStepId, kind: "shell", stdout: "result\n", exitCode: 0 }]);
    expect(provenance.tabs.environment).toMatchObject({
      provided: { shell: "bash" },
      runtime: { kind: "opencode" },
      artifact: { kind: "markdown" },
    });
    expect(provenance.tabs.review).toEqual([]);
    expect(JSON.stringify(provenance.tabs.environment.adapter)).not.toContain("forged");
    expect(JSON.stringify(provenance.tabs.environment.runtime)).not.toContain("forged");
    expect(JSON.stringify(provenance.tabs.environment.artifact)).not.toContain("forged");
    expect(JSON.stringify(provenance)).not.toContain(fakeOpenCode.runtimeSessionId);
    expect(JSON.stringify(provenance)).not.toContain("runtime_call_private_provenance");

    const missingPath = path.join(".adapter-test-artifacts", "missing-provenance.md");
    await fs.promises.writeFile(path.join(process.cwd(), missingPath), "# Missing\n");
    const missingRegistered = await jsonFetch<{ artifact: { id: string }; version: { id: string } }>(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: created.session.id, path: missingPath }),
    });
    const missing = await jsonFetch<{ status: string; missing: string[]; completeness: Record<string, { status: string }> }>(
      `${adapter.baseUrl}/v1/artifacts/${missingRegistered.artifact.id}/versions/${missingRegistered.version.id}/provenance`,
    );
    expect(missing.status).toBe("partial");
    expect(missing.missing).toEqual(["messages", "code", "executionLog", "review"]);
    expect(missing.completeness.messages.status).toBe("missing");
    expect(missing.completeness.executionLog.status).toBe("missing");

    const findingAtRegistration = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.session.id,
        path: missingPath,
        name: "registration-finding.md",
        provenance: {
          review: [
            {
              type: "finding",
              findingId: "finding_supplied_by_client",
              severity: "warning",
              claim: "Registration finding should be rejected",
              evidence: "Only reviewer.run can bind finding evidence",
              transcriptUrl: `#${sourceMessageId}`,
              provenanceUrl: "/v1/artifacts/art_unknown/versions/ver_unknown/provenance",
            },
          ],
        },
      }),
    });
    expect(findingAtRegistration.ok).toBe(false);

    const disguisedFindingAtRegistration = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.session.id,
        path: missingPath,
        name: "registration-disguised-finding.md",
        provenance: {
          review: [
            {
              type: "summary",
              summary: "Looks like summary but carries finding evidence",
              claim: "This should not be stripped",
              evidence: "Unknown evidence",
              transcriptUrl: `#${sourceMessageId}`,
              provenanceUrl: "/v1/artifacts/art_unknown/versions/ver_unknown/provenance",
            },
          ],
        },
      }),
    });
    expect(disguisedFindingAtRegistration.ok).toBe(false);

    const disguisedNotRunAtRegistration = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: created.session.id,
        path: missingPath,
        name: "registration-disguised-not-run-finding.md",
        provenance: {
          review: [
            {
              type: "not_run",
              reason: "Looks absent but carries finding evidence",
              claim: "This should not be stripped either",
              evidence: "Unknown evidence",
              transcriptUrl: `#${sourceMessageId}`,
              provenanceUrl: "/v1/artifacts/art_unknown/versions/ver_unknown/provenance",
            },
          ],
        },
      }),
    });
    expect(disguisedNotRunAtRegistration.ok).toBe(false);
  }, 20_000);

  it("rejects artifact provenance links that are unknown or from another session", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const firstSession = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-provenance-first" }),
    });
    const secondSession = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-provenance-second" }),
    });
    const sourceMessageId = await emitAdapterTextMessage(adapter, fakeOpenCode);
    const toolEvents = await collectWsEvents(
      adapter.wsUrl,
      () => {
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: "runtime_cross_session_tool",
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "tool",
              callID: "runtime_cross_session_call",
              tool: "bash",
              state: { status: "completed", title: "Cross session", output: "ok" },
            },
          },
        });
      },
      1,
      (event) => event.name === "tool.completed",
    );
    const toolStepId = String((toolEvents[0].payload as { toolStepId: string }).toolStepId);

    await fs.promises.mkdir(path.join(process.cwd(), ".adapter-test-artifacts"), { recursive: true });
    const artifactPath = path.join(".adapter-test-artifacts", "bad-provenance.md");
    await fs.promises.writeFile(path.join(process.cwd(), artifactPath), "# Bad provenance\n");

    const rawMessageResponse = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: firstSession.session.id, path: artifactPath, sourceMessageIds: [fakeOpenCode.runtimeMessageId] }),
    });
    expect(rawMessageResponse.status).toBe(500);
    await expect(rawMessageResponse.text()).resolves.not.toContain(fakeOpenCode.runtimeMessageId);

    const crossSessionMessageResponse = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: secondSession.session.id, path: artifactPath, sourceMessageIds: [sourceMessageId] }),
    });
    expect(crossSessionMessageResponse.status).toBe(500);

    const crossSessionToolResponse = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: secondSession.session.id, path: artifactPath, provenance: { executionStepIds: [toolStepId] } }),
    });
    expect(crossSessionToolResponse.status).toBe(500);

    const missingToolResponse = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: firstSession.session.id, path: artifactPath, provenance: { executionStepIds: ["tool_missing"] } }),
    });
    expect(missingToolResponse.status).toBe(500);
  }, 20_000);

  it("ignores tool events without a stable runtime identity so they cannot become provenance evidence", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-malformed-tool" }),
    });

    const events = await collectWsEvents(
      adapter.wsUrl,
      () => {
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "tool",
              tool: "bash",
              state: { status: "completed", title: "No stable identity 1", output: "first" },
            },
          },
        });
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "tool",
              tool: "bash",
              state: { status: "completed", title: "No stable identity 2", output: "second" },
            },
          },
        });
        fakeOpenCode.emitEvent({
          type: "message.part.updated",
          properties: {
            delta: "done",
            part: {
              id: "runtime_text_after_malformed_tool",
              sessionID: fakeOpenCode.runtimeSessionId,
              messageID: fakeOpenCode.runtimeMessageId,
              type: "text",
              text: "done",
            },
          },
        });
      },
      1,
      (event) => event.name === "message.delta",
    );

    expect(events.map(labelEnvelope)).toEqual(["message.delta"]);
  }, 20_000);

  it("rejects artifact registration outside the project root", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const response = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../outside.md" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("outside project root"),
    });
  }, 20_000);

  it("validates session.open and reports unsupported websocket commands explicitly", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const created = await jsonFetch<{ session: { id: string } }>(`${adapter.baseUrl}/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "server-test-open" }),
    });

    const opened = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_session_open",
        command: "session.open",
        payload: { sessionId: created.session.id },
      },
      (next) => labelEnvelope(next) === "session.updated",
    );
    expect(opened.map(labelEnvelope)).toEqual(["ack", "session.updated"]);

    const unsupported = await sendWsCommand(
      adapter.wsUrl,
      {
        type: "command",
        requestId: "req_unsupported",
        command: "project.select",
        payload: {},
      },
      (next) => labelEnvelope(next) === "error",
    );
    expect(unsupported).toContainEqual(
      expect.objectContaining({
        type: "error",
        requestId: "req_unsupported",
        code: "COMMAND_NOT_IMPLEMENTED",
      }),
    );
  }, 20_000);

  it("rejects artifact registration when an in-project link resolves outside the project root", async () => {
    const fakeOpenCode = await startFakeOpenCode();
    const adapter = await startAdapter(fakeOpenCode.port);
    const outsideDir = path.join(process.cwd(), "..", `.adapter-outside-${process.pid}`);
    const outsideFile = path.join(outsideDir, "outside.md");
    const linkPath = path.join(process.cwd(), ".adapter-test-artifacts", "outside-link.md");
    await fs.promises.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.promises.mkdir(outsideDir, { recursive: true });
    await fs.promises.writeFile(outsideFile, "# Outside\n");
    try {
      await fs.promises.symlink(outsideFile, linkPath, "file");
    } catch (error) {
      await fs.promises.rm(outsideDir, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    const response = await fetch(`${adapter.baseUrl}/v1/artifacts/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: path.join(".adapter-test-artifacts", "outside-link.md") }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL_ERROR",
      message: expect.stringContaining("outside project root"),
    });
    await fs.promises.rm(outsideDir, { recursive: true, force: true });
  }, 20_000);
});

async function startFakeOpenCode(
  options: {
    failPrompt?: boolean;
    includeErrorMessage?: boolean;
    closeFirstEventStream?: boolean;
    emitCompletedDuringPrompt?: boolean;
    omitPermissionId?: boolean;
    delayPromptMs?: number;
    failAbort?: boolean;
  } = {},
): Promise<{
  port: number;
  runtimeSessionId: string;
  runtimeMessageId: string;
  eventRequestUrls: string[];
  permissionReplies: Array<{ permissionId: string; response: string }>;
  emitEvent(event: unknown): void;
  emitPermission(input: { id: string; command: string }): void;
  closeEventStreams(): void;
}> {
  const runtimeSessionId = "runtime_session_private";
  const runtimeMessageId = "runtime_message_private";
  const messages: unknown[] = options.includeErrorMessage
    ? [
        {
          info: {
            id: runtimeMessageId,
            role: "assistant",
            time: { created: Date.now() },
            error: {
              name: "ProviderAuthError",
              data: {
                providerID: "deepseek",
                message: "secret-provider-detail",
              },
            },
          },
          parts: [],
        },
      ]
    : [];
  const eventClients = new Set<ServerResponse>();
  const eventRequestUrls: string[] = [];
  const permissionReplies: Array<{ permissionId: string; response: string }> = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url?.startsWith("/global/health")) {
      return sendJson(response, { healthy: true, version: "1.17.12" });
    }
    if (request.method === "GET" && request.url?.startsWith("/event")) {
      eventRequestUrls.push(request.url);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      if (options.closeFirstEventStream && eventRequestUrls.length === 1) {
        setTimeout(() => response.end(), 50);
        return;
      }
      eventClients.add(response);
      request.on("close", () => eventClients.delete(response));
      return;
    }
    if (request.method === "POST" && request.url?.startsWith(`/session/${runtimeSessionId}/message`)) {
      await readBody(request);
      if (options.failPrompt) {
        return sendJson(
          response,
          {
            name: "ProviderAuthError",
            data: {
              providerID: "deepseek",
              message: "secret-provider-detail",
            },
          },
          500,
        );
      }
      if (options.delayPromptMs) await sleep(options.delayPromptMs);
      const created = Date.now();
      if (options.emitCompletedDuringPrompt) {
        writeSseEvent(eventClients, {
          type: "message.updated",
          properties: {
            info: {
              id: runtimeMessageId,
              sessionID: runtimeSessionId,
              role: "assistant",
              time: { created, completed: created },
            },
          },
        });
      }
      const assistant = {
        info: {
          id: runtimeMessageId,
          role: "assistant",
          time: { created, completed: created },
        },
        parts: [{ id: "runtime_part_private", type: "text", text: "OK" }],
      };
      messages.push(assistant);
      return sendJson(response, assistant);
    }
    if (request.method === "GET" && request.url?.startsWith(`/session/${runtimeSessionId}/message`)) {
      return sendJson(response, messages);
    }
    if (request.method === "POST" && request.url?.startsWith(`/session/${runtimeSessionId}/abort`)) {
      await readBody(request);
      if (options.failAbort) return sendJson(response, { error: "abort failed" }, 500);
      return sendJson(response, true);
    }
    if (request.method === "POST" && request.url?.startsWith(`/session/${runtimeSessionId}/permissions/`)) {
      const body = JSON.parse(await readBody(request)) as { response?: string };
      const permissionId = decodeURIComponent(request.url.split("/permissions/")[1]?.split("?")[0] ?? "");
      permissionReplies.push({ permissionId, response: body.response ?? "" });
      return sendJson(response, true);
    }
    if (request.method === "POST" && request.url?.startsWith("/session")) {
      await readBody(request);
      return sendJson(response, { id: runtimeSessionId });
    }
    sendJson(response, { error: "not found" }, 404);
  });
  await listen(server, 0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  return {
    port: address.port,
    runtimeSessionId,
    runtimeMessageId,
    eventRequestUrls,
    permissionReplies,
    emitEvent: (event: unknown) => {
      writeSseEvent(eventClients, event);
    },
    emitPermission: (input: { id: string; command: string }) => {
      writeSseEvent(eventClients, {
        type: "permission.updated",
        properties: {
          ...(options.omitPermissionId ? {} : { id: input.id }),
          type: "shell",
          sessionID: runtimeSessionId,
          messageID: runtimeMessageId,
          title: "Run shell command",
          metadata: { command: input.command },
          time: { created: Date.now() },
        },
      });
    },
    closeEventStreams: () => {
      for (const client of eventClients) client.end();
      eventClients.clear();
    },
  };
}

async function startAdapter(opencodePort: number): Promise<{ baseUrl: string; wsUrl: string; storageRoot: string }> {
  const adapterPort = await getFreePort();
  const storageRoot = path.join(process.cwd(), "..", `.adapter-test-storage-${adapterPort}`);
  storageRoots.push(storageRoot);
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/adapter/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADAPTER_RUNTIME_MODE: "external",
      ADAPTER_PORT: String(adapterPort),
      ADAPTER_STORAGE_ROOT: storageRoot,
      OPENCODE_PORT: String(opencodePort),
    },
    windowsHide: true,
  });
  processes.push(child);
  const baseUrl = `http://127.0.0.1:${adapterPort}`;
  await waitForAdapter(baseUrl);
  return { baseUrl, wsUrl: `ws://127.0.0.1:${adapterPort}/v1/ws`, storageRoot };
}

async function sendWsCommand(
  url: string,
  command: unknown,
  stopWhen: (envelope: Record<string, unknown>, envelopes: Record<string, unknown>[]) => boolean = (envelope) =>
    labelEnvelope(envelope) === "session.statusChanged" &&
    ((envelope.payload as { status?: string } | undefined)?.status === "idle"),
): Promise<Array<Record<string, unknown>>> {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) throw new Error("WebSocket is not available in this Node runtime");
  return new Promise((resolve, reject) => {
    const envelopes: Array<Record<string, unknown>> = [];
    const socket = new WebSocketCtor(url);
    const timeout = setTimeout(() => reject(new Error(`WebSocket timed out: ${envelopes.map(labelEnvelope).join(",")}`)), 10_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify(command)));
    socket.addEventListener("message", (event) => {
      const envelope = JSON.parse(String(event.data)) as Record<string, unknown>;
      envelopes.push(envelope);
      if (stopWhen(envelope, envelopes)) {
        clearTimeout(timeout);
        socket.close();
        resolve(envelopes);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error"));
    });
  });
}

function labelEnvelope(envelope: Record<string, unknown>): string {
  return envelope.type === "event" ? String(envelope.name) : String(envelope.type);
}

async function collectWsEvents(
  url: string,
  afterOpen?: () => void,
  expectedCount = 7,
  eventFilter?: (event: Record<string, unknown>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const envelopes = await collectWsEnvelopes(url, afterOpen, expectedCount, true, eventFilter);
  return envelopes.filter((envelope) => envelope.type === "event");
}

async function collectPermissionEvent(
  url: string,
  afterOpen: () => void,
  eventName = "permission.requested",
): Promise<Record<string, unknown>> {
  const events = await collectWsEvents(url, afterOpen, 1, (event) => event.name === eventName);
  return events[0];
}

async function emitAdapterTextMessage(adapter: { wsUrl: string }, fakeOpenCode: { runtimeSessionId: string; runtimeMessageId: string; emitEvent(event: unknown): void }): Promise<string> {
  const events = await collectWsEvents(
    adapter.wsUrl,
    () => {
      fakeOpenCode.emitEvent({
        type: "message.part.updated",
        properties: {
          delta: "source",
          part: {
            id: `runtime_source_part_${Date.now()}_${Math.random()}`,
            sessionID: fakeOpenCode.runtimeSessionId,
            messageID: fakeOpenCode.runtimeMessageId,
            type: "text",
            text: "source",
          },
        },
      });
    },
    1,
    (event) => event.name === "message.delta",
  );
  return String((events[0].payload as { messageId: string }).messageId);
}

async function stageAnnotation(
  adapter: { wsUrl: string },
  sessionId: string,
  artifactId: string,
  versionId: string | undefined,
  body: string,
  anchor: Record<string, unknown>,
): Promise<{ id: string; versionId?: string; status: string }> {
  const payload: Record<string, unknown> = {
    sessionId,
    artifactId,
    body,
    anchor,
  };
  if (versionId) payload.versionId = versionId;
  const events = await sendWsCommand(
    adapter.wsUrl,
    {
      type: "command",
      requestId: `req_stage_annotation_${Date.now()}_${Math.random()}`,
      command: "annotation.stage",
      payload,
    },
    (next) => labelEnvelope(next) === "annotation.staged",
  );
  return (events.find((event) => labelEnvelope(event) === "annotation.staged")?.payload as { annotation: { id: string; versionId?: string; status: string } }).annotation;
}

async function emitAdapterToolStep(
  adapter: { wsUrl: string },
  fakeOpenCode: { runtimeSessionId: string; runtimeMessageId: string; emitEvent(event: unknown): void },
  title: string,
  output: string,
  status: "running" | "completed" = "completed",
): Promise<string> {
  const events = await collectWsEvents(
    adapter.wsUrl,
    () => {
      fakeOpenCode.emitEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `runtime_tool_part_${Date.now()}_${Math.random()}`,
            sessionID: fakeOpenCode.runtimeSessionId,
            messageID: fakeOpenCode.runtimeMessageId,
            type: "tool",
            callID: `runtime_tool_call_${Date.now()}_${Math.random()}`,
            tool: "bash",
            state: status === "completed" ? { status, title, output, metadata: { exitCode: 0 } } : { status, title },
          },
        },
      });
    },
    1,
    (event) => event.name === (status === "completed" ? "tool.completed" : "tool.started"),
  );
  return String((events[0].payload as { toolStepId: string }).toolStepId);
}

async function collectWsEnvelopes(
  url: string,
  afterOpen?: () => void,
  expectedCount = 7,
  eventsOnly = false,
  eventFilter?: (event: Record<string, unknown>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) throw new Error("WebSocket is not available in this Node runtime");
  return new Promise((resolve, reject) => {
    const envelopes: Array<Record<string, unknown>> = [];
    const socket = new WebSocketCtor(url);
    const timeout = setTimeout(() => reject(new Error(`WebSocket event collection timed out: ${envelopes.map(labelEnvelope).join(",")}`)), 10_000);
    socket.addEventListener("open", () => {
      setTimeout(() => afterOpen?.(), 100);
    });
    socket.addEventListener("message", (event) => {
      const envelope = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (!eventsOnly || (envelope.type === "event" && (!eventFilter || eventFilter(envelope)))) envelopes.push(envelope);
      if (envelopes.length >= expectedCount) {
        clearTimeout(timeout);
        socket.close();
        resolve(envelopes);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket error"));
    });
  });
}

function writeSseEvent(clients: Set<ServerResponse>, event: unknown): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
}

async function waitForAdapter(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/v1/health`);
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Adapter did not start at ${baseUrl}`);
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function getFreePort(): Promise<number> {
  const server = http.createServer();
  await listen(server, 0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP server address");
  const port = address.port;
  await closeServer(server);
  return port;
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function sendJson(response: ServerResponse, body: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function stopProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  child.kill("SIGTERM");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
