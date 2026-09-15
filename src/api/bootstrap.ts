import { apiRequest } from "./client";
import { getCachedBootstrapPayload } from "./bootstrapCache";
import type { BootstrapResponse } from "../types/bootstrap";

let bootstrapRequestPromise:
  Promise<BootstrapResponse> | null =
    null;

/**
 * bootstrap은 apiRequest의 메모리 캐시를 사용하며, 동시에 여러 화면이
 * 요청해도 같은 네트워크 Promise를 공유합니다.
 */
export function getBootstrap<
  TResponse = BootstrapResponse
>() {
  if (!bootstrapRequestPromise) {
    const task =
      apiRequest<BootstrapResponse>(
        "/api/bootstrap"
      );

    bootstrapRequestPromise =
      task;

    void task.finally(
      () => {
        if (
          bootstrapRequestPromise ===
            task
        ) {
          bootstrapRequestPromise =
            null;
        }
      }
    );
  }

  return bootstrapRequestPromise as
    Promise<TResponse>;
}

/**
 * 홈을 보는 동안 입력용 master data를 미리 받아 둡니다.
 * 실패해도 홈 화면은 막지 않고 실제 입력 화면에서 다시 시도합니다.
 */
export async function prefetchBootstrap() {
  if (
    getCachedBootstrapPayload<BootstrapResponse>()
  ) {
    return;
  }

  try {
    await getBootstrap();
  } catch {
    // 프리페치 실패는 사용자 작업을 막지 않습니다.
  }
}
