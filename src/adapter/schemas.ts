import { z } from "zod";

export const clientCommandSchema = z.object({
  type: z.literal("command"),
  requestId: z.string().min(1),
  command: z.string().min(1),
  payload: z.unknown().optional(),
});

export const createSessionPayloadSchema = z
  .object({
    projectId: z.string().optional(),
    title: z.string().optional(),
    parentId: z.string().optional(),
  })
  .default({});

export const sendMessagePayloadSchema = z.object({
  sessionId: z.string().min(1),
  parts: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), text: z.string() }),
        z.object({ type: z.literal("artifact_ref"), artifactId: z.string(), versionId: z.string().optional() }),
        z.object({ type: z.literal("session_ref"), sessionId: z.string() }),
        z.object({ type: z.literal("upload_ref"), uploadId: z.string() }),
        z.object({ type: z.literal("skill_ref"), skillId: z.string() }),
      ]),
    )
    .min(1),
  annotationIds: z.array(z.string()).optional(),
});

const annotationAnchorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markdown"),
    path: z.string().min(1).optional(),
    startLine: z.number().int().nonnegative().optional(),
    endLine: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
  }),
  z.object({
    type: z.literal("code"),
    path: z.string().min(1).optional(),
    startLine: z.number().int().nonnegative().optional(),
    endLine: z.number().int().nonnegative().optional(),
    symbol: z.string().optional(),
  }),
  z.object({
    type: z.literal("pdf_text"),
    page: z.number().int().nonnegative(),
    text: z.string().optional(),
    rects: z.array(z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })).optional(),
  }),
  z.object({
    type: z.literal("image_point"),
    x: z.number(),
    y: z.number(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("html_element"),
    selector: z.string().min(1),
    text: z.string().optional(),
  }),
]);

export const annotationStagePayloadSchema = z.object({
  sessionId: z.string().min(1),
  artifactId: z.string().min(1),
  versionId: z.string().min(1).optional(),
  body: z.string().min(1),
  anchor: annotationAnchorSchema,
});

export const annotationDiscardPayloadSchema = z.object({
  annotationIds: z.array(z.string().min(1)).min(1),
});

export const annotationCommitWithMessagePayloadSchema = z.object({
  sessionId: z.string().min(1),
  annotationIds: z.array(z.string().min(1)).min(1),
  parts: sendMessagePayloadSchema.shape.parts,
});

const reviewFindingInputSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  claim: z.string().min(1),
  evidence: z.string().min(1),
  transcriptUrl: z.string().min(1),
  provenanceUrl: z.string().min(1),
});

export const reviewerRunPayloadSchema = z.object({
  sessionId: z.string().min(1),
  artifactId: z.string().min(1).optional(),
  versionId: z.string().min(1).optional(),
  mode: z.enum(["manual", "automatic"]).optional(),
  findings: z.array(reviewFindingInputSchema).optional(),
  failReason: z.string().min(1).optional(),
});

export const trackSpawnPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    title: z.string().min(1),
    parentTrackId: z.string().min(1).optional(),
    agentKind: z.string().min(1).optional(),
    transcriptUrl: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const trackUpdatePayloadSchema = z
  .object({
    trackId: z.string().min(1),
    status: z.enum(["running", "blocked", "completed", "failed"]).optional(),
    message: z.string().min(1).optional(),
    transcriptUrl: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.message !== undefined || value.transcriptUrl !== undefined || value.error !== undefined, {
    message: "status, message, transcriptUrl, or error is required",
  });

export const trackStopPayloadSchema = z
  .object({
    trackId: z.string().min(1),
    reason: z.string().min(1).optional(),
  })
  .strict();

export const remoteJobSubmitPayloadSchema = z
  .object({
    sessionId: z.string().min(1),
    trackId: z.string().min(1).optional(),
    provider: z.string().min(1),
    title: z.string().min(1),
    command: z.string().min(1).optional(),
    externalUrl: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const remoteJobUpdatePayloadSchema = z
  .object({
    jobId: z.string().min(1),
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
    externalUrl: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    artifactIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const remoteJobAppendLogPayloadSchema = z
  .object({
    jobId: z.string().min(1),
    stream: z.enum(["stdout", "stderr", "system"]).default("system"),
    text: z.string().min(1),
  })
  .strict();

export const stopSessionPayloadSchema = z.object({
  sessionId: z.string().min(1),
});

export const sessionOpenPayloadSchema = z.object({
  sessionId: z.string().min(1),
});

export const permissionResponsePayloadSchema = z.object({
  permissionId: z.string().min(1),
  decision: z.enum(["approve", "deny"]),
  scope: z.enum(["once", "conversation", "project", "global"]).optional(),
  reason: z.string().optional(),
});

export const permissionRevokePayloadSchema = z.object({
  permissionId: z.string().min(1),
});

const planStepInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  executionStepIds: z.array(z.string().min(1)).optional(),
});

export const planProposePayloadSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  steps: z.array(planStepInputSchema).min(1),
});

export const planApprovePayloadSchema = z.object({
  planId: z.string().min(1),
});

export const planRequestRevisionPayloadSchema = z.object({
  planId: z.string().min(1),
  message: z.string().min(1),
});

export const planRecordStepResultPayloadSchema = z.object({
  planId: z.string().min(1),
  stepId: z.string().min(1),
  executionStepIds: z.array(z.string().min(1)).min(1),
});

export const artifactIdPayloadSchema = z.object({
  artifactId: z.string().min(1),
});

export const artifactRenamePayloadSchema = artifactIdPayloadSchema.extend({
  name: z.string().min(1),
});

export const artifactStarPayloadSchema = artifactIdPayloadSchema.extend({
  starred: z.boolean(),
});

export const artifactOpenPayloadSchema = artifactIdPayloadSchema.extend({
  versionId: z.string().min(1).optional(),
  mode: z.enum(["primary", "beside"]).optional(),
});

export const artifactDownloadUrlPayloadSchema = artifactIdPayloadSchema.extend({
  versionId: z.string().min(1).optional(),
});

const provenanceCodeSchema = z.object({
  language: z.string().min(1),
  content: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

const provenanceReviewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("summary"),
    summary: z.string().min(1),
  }).strict(),
  z.object({
    type: z.literal("not_run"),
    reason: z.string().min(1).optional(),
  }).strict(),
]);

export const artifactRegisterPayloadSchema = z.object({
  sessionId: z.string().min(1).optional(),
  path: z.string().min(1),
  kind: z
    .enum(["figure", "pdf", "markdown", "notebook", "table", "code", "environment", "review", "html", "unknown"])
    .optional(),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  sourceMessageIds: z.array(z.string()).optional(),
  provenance: z
    .object({
      executionStepIds: z.array(z.string().min(1)).optional(),
      code: z.array(provenanceCodeSchema).optional(),
      environment: z.record(z.string(), z.unknown()).optional(),
      review: z.array(provenanceReviewSchema).optional(),
    })
    .optional(),
});

export const artifactPatchPayloadSchema = z
  .object({
    name: z.string().min(1).optional(),
    starred: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.starred !== undefined, {
    message: "name or starred is required",
  });
