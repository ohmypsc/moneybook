import {
  getBootstrapCacheGeneration,
  getCachedBootstrapPayload,
  handleSuccessfulApiMutation,
  rememberBootstrapPayload
} from "./bootstrapCache.ts";
import { notifyAuthExpired } from "../utils/authEvents.ts";

export class ApiError
  extends Error {

  status: number;
  code: string;

  constructor(
    message: string,
    status = 500,
    code = "API_ERROR"
  ) {
    super(message);

    this.name =
      "ApiError";

    this.status =
      status;

    this.code =
      code;
  }
}

interface ErrorEnvelope {
  success?: boolean;

  error?: {
    code?: string;
    message?: string;
  };
}

const BOOTSTRAP_PATH =
  "/api/bootstrap";

const DEFAULT_API_TIMEOUT_MS = 30_000;

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
}

function getPathname(
  url: string
) {
  const hashIndex =
    url.indexOf("#");

  const withoutHash =
    hashIndex >= 0
      ? url.slice(0, hashIndex)
      : url;

  const queryIndex =
    withoutHash.indexOf("?");

  return queryIndex >= 0
    ? withoutHash.slice(0, queryIndex)
    : withoutHash;
}

export async function apiRequest<T>(
  url: string,
  init: ApiRequestInit = {}
): Promise<T> {
  const method =
    String(
      init.method || "GET"
    ).toUpperCase();

  const pathname =
    getPathname(url);

  const isBootstrapRequest =
    method === "GET" &&
    pathname === BOOTSTRAP_PATH;

  if (
    isBootstrapRequest
  ) {
    const cached =
      getCachedBootstrapPayload<T>();

    if (cached) {
      return cached;
    }
  }

  const requestGeneration =
    isBootstrapRequest
      ? getBootstrapCacheGeneration()
      : -1;

  const {
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    signal: externalSignal,
    ...requestInit
  } = init;

  const headers =
    new Headers(
      requestInit.headers
    );

  if (
    requestInit.body &&
    !headers.has(
      "Content-Type"
    )
  ) {
    headers.set(
      "Content-Type",
      "application/json"
    );
  }

  const controller =
    new AbortController();

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const abortFromExternalSignal = () => {
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener(
        "abort",
        abortFromExternalSignal,
        { once: true }
      );
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutHandle = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      timeoutMs
    );
  }

  let response: Response;

  try {
    response = await fetch(
      url,
      {
        ...requestInit,
        headers,
        credentials: "same-origin",
        signal: controller.signal
      }
    );
  } catch (error) {
    if (timedOut) {
      throw new ApiError(
        "서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.",
        408,
        "REQUEST_TIMEOUT"
      );
    }

    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }

    externalSignal?.removeEventListener(
      "abort",
      abortFromExternalSignal
    );
  }

  let data: unknown;

  try {
    data =
      await response.json();
  } catch {
    throw new ApiError(
      "서버 응답을 읽을 수 없습니다.",
      response.status,
      "INVALID_RESPONSE"
    );
  }

  const envelope =
    data as ErrorEnvelope;

  if (
    !response.ok ||
    envelope.success === false
  ) {
    if (
      response.status === 401 &&
      !pathname.startsWith("/api/auth/")
    ) {
      notifyAuthExpired();
    }

    throw new ApiError(
      envelope.error?.message ||
        "요청 처리 중 오류가 발생했습니다.",
      response.status,
      envelope.error?.code ||
        "API_ERROR"
    );
  }

  if (
    isBootstrapRequest
  ) {
    rememberBootstrapPayload(
      data,
      requestGeneration
    );
  } else if (
    method !== "GET"
  ) {
    handleSuccessfulApiMutation(
      pathname
    );
  }

  return data as T;
}
