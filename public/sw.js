const CACHE_VERSION =
  "v3-splash";

const STATIC_CACHE =
  `moneybook-static-${CACHE_VERSION}`;

const RUNTIME_CACHE =
  `moneybook-runtime-${CACHE_VERSION}`;

const CACHE_PREFIX =
  "moneybook-";


const PRECACHE_URLS = [
  "/",
  "/splash-photo.jpg",
  "/manifest.webmanifest"
];


function isApiRequest(
  url
) {
  return url.pathname.startsWith(
    "/api/"
  );
}


function isStaticAssetRequest(
  request,
  url
) {
  if (
    request.destination ===
    "script"
  ) {
    return true;
  }

  if (
    request.destination ===
    "style"
  ) {
    return true;
  }

  if (
    request.destination ===
    "image"
  ) {
    return true;
  }

  if (
    request.destination ===
    "font"
  ) {
    return true;
  }

  if (
    url.pathname.startsWith(
      "/assets/"
    )
  ) {
    return true;
  }

  if (
    url.pathname.startsWith(
      "/icons/"
    )
  ) {
    return true;
  }

  if (
    url.pathname ===
    "/manifest.webmanifest"
  ) {
    return true;
  }

  return false;
}


async function putIfCacheable(
  cacheName,
  request,
  response
) {
  if (
    !response ||
    !response.ok
  ) {
    return response;
  }

  const cache =
    await caches.open(
      cacheName
    );

  await cache.put(
    request,
    response.clone()
  );

  return response;
}


/*
 * 스플래시 사진 전용.
 *
 * 이미 캐시되어 있으면
 * 캐시 사진을 즉시 반환하고,
 * 최신 파일은 뒤에서 조용히 갱신합니다.
 */
async function cacheFirstWithBackgroundRefresh(
  request
) {
  const cache =
    await caches.open(
      STATIC_CACHE
    );

  const cached =
    await cache.match(
      request,
      {
        ignoreSearch: true
      }
    );


  const networkPromise =
    fetch(
      request,
      {
        cache: "no-cache"
      }
    )
      .then(
        async response => {
          if (
            response.ok
          ) {
            await cache.put(
              request,
              response.clone()
            );
          }

          return response;
        }
      )
      .catch(
        () => null
      );


  if (cached) {
    return {
      response: cached,
      refresh:
        networkPromise
    };
  }


  const networkResponse =
    await networkPromise;


  if (
    networkResponse
  ) {
    return {
      response:
        networkResponse,

      refresh: null
    };
  }


  return {
    response:
      new Response(
        "",
        {
          status: 504,
          statusText:
            "Gateway Timeout"
        }
      ),

    refresh: null
  };
}


/*
 * HTML은 새 버전 확인을 위해
 * 네트워크를 먼저 봅니다.
 *
 * 인터넷이 끊겼을 때만
 * 저장된 앱 셸을 사용합니다.
 */
async function networkFirstNavigation(
  request
) {
  try {
    const response =
      await fetch(
        request,
        {
          cache: "no-cache"
        }
      );


    if (
      response.ok
    ) {
      const cache =
        await caches.open(
          RUNTIME_CACHE
        );

      await cache.put(
        "/",
        response.clone()
      );
    }


    return response;

  } catch {
    const runtimeCache =
      await caches.open(
        RUNTIME_CACHE
      );

    const runtimeFallback =
      await runtimeCache.match(
        "/"
      );


    if (
      runtimeFallback
    ) {
      return runtimeFallback;
    }


    const staticCache =
      await caches.open(
        STATIC_CACHE
      );

    const staticFallback =
      await staticCache.match(
        "/"
      );


    if (
      staticFallback
    ) {
      return staticFallback;
    }


    return new Response(
      "앱을 불러오지 못했습니다. 인터넷 연결을 확인해주세요.",
      {
        status: 503,

        headers: {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      }
    );
  }
}


/*
 * 새 Service Worker가 설치될 때
 * 스플래시 사진을 미리 저장합니다.
 */
self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      (
        async () => {
          const cache =
            await caches.open(
              STATIC_CACHE
            );


          /*
           * 어느 한 파일에 문제가 생겨도
           * 전체 Service Worker 설치가
           * 실패하지 않게 개별 처리합니다.
           */
          await Promise.allSettled(
            PRECACHE_URLS.map(
              async url => {
                const request =
                  new Request(
                    url,
                    {
                      cache:
                        "reload"
                    }
                  );


                const response =
                  await fetch(
                    request
                  );


                if (
                  !response.ok
                ) {
                  throw new Error(
                    `Precache failed: ${url}`
                  );
                }


                await cache.put(
                  request,
                  response
                );
              }
            )
          );


          await self.skipWaiting();
        }
      )()
    );
  }
);


/*
 * 새 Service Worker가 활성화되면
 * 예전 moneybook 캐시를 정리합니다.
 */
self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      (
        async () => {
          const cacheNames =
            await caches.keys();


          await Promise.all(
            cacheNames.map(
              cacheName => {
                if (
                  cacheName.startsWith(
                    CACHE_PREFIX
                  ) &&
                  cacheName !==
                    STATIC_CACHE &&
                  cacheName !==
                    RUNTIME_CACHE
                ) {
                  return caches.delete(
                    cacheName
                  );
                }


                return Promise.resolve(
                  false
                );
              }
            )
          );


          await self.clients.claim();
        }
      )()
    );
  }
);


/*
 * 요청 처리
 */
self.addEventListener(
  "fetch",
  event => {
    const {
      request
    } =
      event;


    /*
     * GET 이외의 저장 요청은
     * 절대 Service Worker에서
     * 캐시하지 않습니다.
     */
    if (
      request.method !==
      "GET"
    ) {
      return;
    }


    const url =
      new URL(
        request.url
      );


    /*
     * 외부 사이트 자산은
     * 건드리지 않습니다.
     */
    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }


    /*
     * 매우 중요:
     *
     * 가계부 API 응답은
     * Service Worker 캐시를
     * 완전히 우회합니다.
     */
    if (
      isApiRequest(
        url
      )
    ) {
      return;
    }


    /*
     * 앱 HTML
     */
    if (
      request.mode ===
      "navigate"
    ) {
      event.respondWith(
        networkFirstNavigation(
          request
        )
      );

      return;
    }


    /*
     * 스플래시 사진
     *
     * 캐시가 있다면
     * 네트워크를 기다리지 않고
     * 즉시 반환합니다.
     */
    if (
      url.pathname ===
      "/splash-photo.jpg"
    ) {
      event.respondWith(
        (
          async () => {
            const result =
              await cacheFirstWithBackgroundRefresh(
                request
              );


            if (
              result.refresh
            ) {
              event.waitUntil(
                result.refresh
              );
            }


            return result.response;
          }
        )()
      );

      return;
    }


    /*
     * Vite JS/CSS, 아이콘 등의
     * 정적 자산.
     *
     * 한 번 받은 파일은
     * 다음부터 캐시에서 빠르게 사용합니다.
     */
    if (
      isStaticAssetRequest(
        request,
        url
      )
    ) {
      event.respondWith(
        (
          async () => {
            const cache =
              await caches.open(
                RUNTIME_CACHE
              );


            const cached =
              await cache.match(
                request
              );


            if (
              cached
            ) {
              return cached;
            }


            try {
              const response =
                await fetch(
                  request
                );


              return await putIfCacheable(
                RUNTIME_CACHE,
                request,
                response
              );

            } catch {
              return new Response(
                "",
                {
                  status: 504,

                  statusText:
                    "Gateway Timeout"
                }
              );
            }
          }
        )()
      );
    }
  }
);
