export interface ApiEnvelope<T> {
  success?: boolean;
  apiVersion?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  [key: string]: unknown;
}

/**
 * 백엔드 응답이
 *  { success, data: {...} } 형태든
 *  { success, ...필드들 } 형태든
 * 상관없이 실제 데이터만 꺼내주는 헬퍼.
 */
export function unwrapEnvelope<T>(
  payload: ApiEnvelope<T> | T
): T {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in (payload as ApiEnvelope<T>)
  ) {
    const envelope = payload as ApiEnvelope<T>;

    if (envelope.success === false) {
      throw new Error(
        envelope.error?.message ||
          "요청이 실패했습니다."
      );
    }

    if (envelope.data !== undefined) {
      return envelope.data;
    }

    const {
      success,
      apiVersion,
      error,
      ...rest
    } = envelope;

    return rest as T;
  }

  return payload as T;
}
