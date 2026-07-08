export type AdapterErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "AUTH_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "UNAVAILABLE"
  | "REMOTE_ERROR"
  | "PARSE_ERROR"
  | "UNSUPPORTED"
  | "UNKNOWN";

export interface AdapterErrorShape<TCode extends string = AdapterErrorCode> {
  code: TCode;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface AdapterOperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class AdapterError<TCode extends string = AdapterErrorCode>
  extends Error
  implements AdapterErrorShape<TCode>
{
  readonly code: TCode;
  readonly retryable?: boolean;
  readonly details?: unknown;

  constructor(shape: AdapterErrorShape<TCode>, options?: ErrorOptions) {
    super(shape.message, options);
    this.name = "AdapterError";
    this.code = shape.code;
    this.retryable = shape.retryable;
    this.details = shape.details;
  }
}

export function isAdapterError<TCode extends string = AdapterErrorCode>(
  error: unknown
): error is AdapterError<TCode> {
  return error instanceof AdapterError;
}
