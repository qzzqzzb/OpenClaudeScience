import { translate, type CopyKey } from "./i18n.ts";

type Translate = (
  key: CopyKey,
  params?: Record<string, string | number>
) => string;

const defaultTranslate: Translate = (key, params) =>
  translate("zh", key, params);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return JSON.stringify(error);
}

function specificProviderErrorMessage(
  message: string,
  t: Translate
): string | null {
  const normalized = message.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const lowered = normalized.toLowerCase();

  if (normalized.includes("当前模型端点不支持图片输入")) {
    return t("imageInputUnsupported");
  }

  const mentionsImageUrl = lowered.includes("image_url");
  const textOnlyVariant =
    /unknown variant\s+`?image_url`?/i.test(normalized) &&
    /expected\s+`?text`?/i.test(normalized);
  const explicitImageUnsupported =
    /no endpoints found that support image input/i.test(normalized) ||
    /does not support image input/i.test(normalized) ||
    /unsupported image input/i.test(normalized);

  if ((mentionsImageUrl && textOnlyVariant) || explicitImageUnsupported) {
    return t("imageInputUnsupported");
  }

  return null;
}

export function formatChatError(
  error: unknown,
  t: Translate = defaultTranslate
): string | null {
  if (!error) {
    return null;
  }

  const message = normalizeErrorMessage(error);
  const specificMessage = specificProviderErrorMessage(message, t);
  if (specificMessage) {
    return specificMessage;
  }

  if (isMalformedRemoteRuntimeError(message)) {
    return t("remoteRuntimeMalformed");
  }

  const remoteRuntimeMessage = extractRemoteRuntimeErrorMessage(message, t);
  if (remoteRuntimeMessage) {
    return t("remoteRuntimeFailed", { message: remoteRuntimeMessage });
  }

  if (/ConnectError|connection|connect/i.test(message)) {
    return t("modelConnectionFailed");
  }

  if (/RemoteException/i.test(message)) {
    return t("remoteRuntimeCheckLogs");
  }

  return message || t("runFailedRetry");
}

export function isMalformedRemoteRuntimeError(message: string): boolean {
  return (
    /Response validation failed/i.test(message) &&
    /body\.error\.code/i.test(message)
  );
}

export function extractRemoteRuntimeErrorMessage(
  message: string,
  t: Translate = defaultTranslate
): string | null {
  if (!/RemoteException/i.test(message)) {
    return null;
  }

  const normalized = message.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const extracted =
    normalized.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ??
    null;

  const normalizedExtracted = extracted?.replace(
    /^远程 Agent runtime 执行失败[:：]\s*/,
    ""
  );
  const candidate = normalizedExtracted ?? normalized;

  const specificMessage = specificProviderErrorMessage(candidate, t);
  if (specificMessage) {
    return specificMessage;
  }

  if (isMalformedRemoteRuntimeError(candidate)) {
    return t("remoteRuntimeMalformedShort");
  }

  if (/Insufficient credits/i.test(candidate)) {
    return t("insufficientCredits");
  }

  if (/User not found|Unauthorized|401/i.test(candidate)) {
    return t("apiKeyInvalid");
  }

  return normalizedExtracted ?? null;
}
