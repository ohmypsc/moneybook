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

export async function apiRequest<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {

  const headers =
    new Headers(
      init.headers
    );

  if (
    init.body &&
    !headers.has(
      "Content-Type"
    )
  ) {
    headers.set(
      "Content-Type",
      "application/json"
    );
  }

  const response =
    await fetch(
      url,
      {
        ...init,

        headers,

        credentials:
          "same-origin"
      }
    );

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
    throw new ApiError(
      envelope.error?.message ||
        "요청 처리 중 오류가 발생했습니다.",

      response.status,

      envelope.error?.code ||
        "API_ERROR"
    );
  }

  return data as T;
}
