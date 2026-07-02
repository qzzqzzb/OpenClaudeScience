import { OpenCodeRuntimeError, RuntimeUnavailableError, UnsupportedMessagePartError } from "./runtime/opencode.js";

export type AdapterErrorBody = {
  code: string;
  message: string;
  statusCode: number;
  details?: unknown;
};

export class AdapterCommandNotImplementedError extends Error {
  readonly code = "COMMAND_NOT_IMPLEMENTED";
  readonly statusCode = 501;
}

export function toAdapterError(error: unknown): AdapterErrorBody {
  if (error instanceof RuntimeUnavailableError) {
    return {
      code: "RUNTIME_UNAVAILABLE",
      message: error.message,
      statusCode: 503,
    };
  }

  if (error instanceof UnsupportedMessagePartError) {
    return {
      code: "UNSUPPORTED_MESSAGE_PART",
      message: error.message,
      statusCode: 400,
    };
  }

  if (error instanceof OpenCodeRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof AdapterCommandNotImplementedError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
    };
  }

  if (error instanceof Error && error.message.includes("not found")) {
    return {
      code: "NOT_FOUND",
      message: error.message,
      statusCode: 404,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
    statusCode: 500,
  };
}
