const CACHE_VERSION =
  "v8.8.1-macaron-neutral";

const STATIC_CACHE =
  `moneybook-static-${CACHE_VERSION}`;

const RUNTIME_CACHE =
  `moneybook-runtime-${CACHE_VERSION}`;

const CACHE_PREFIX =
  "moneybook-";


const PRECACHE_URLS = [
  "/splash-photo.jpg",
  "/splash-thumb.jpg",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-512.png"
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
 * 새 Service Worker가 설치될 때 현재 index.html이 참조하는
 * Vite JS/CSS와, 그 JS가 나중에 불러오는 화면별 JS/CSS까지 함께 저장합니다.
 * (화면별 코드는 처음 열 때가 아니라 필요할 때 받으므로, 오프라인에서도
 * 모든 화면이 열리려면 설치 시점에 미리 받아 두어야 합니다.)
 * 핵심 앱 셸 중 하나라도 실패하면 새 Worker를 활성화하지 않아 기존 정상 캐시를 보존합니다.
 */
const ASSET_REFERENCE_PATTERN = /(?:^|[^A-Za-z0-9_.-])\/?assets\/([A-Za-z0-9_.-]+\.(?:js|css))/g;
const RELATIVE_CHUNK_PATTERN = /["']\.\/([A-Za-z0-9_.-]+\.(?:js|css))["']/g;

function findAssetUrls(text, { includeRelative }) {
  const urls = new Set();

  for (const match of text.matchAll(ASSET_REFERENCE_PATTERN)) {
    urls.add(`/assets/${match[1]}`);
  }

  if (includeRelative) {
    for (const match of text.matchAll(RELATIVE_CHUNK_PATTERN)) {
      urls.add(`/assets/${match[1]}`);
    }
  }

  return urls;
}

async function precacheUrl(cache, url) {
  const request = new Request(url, { cache: "reload" });
  const response = await fetch(request);

  if (!response.ok) {
    throw new Error(`Precache failed: ${url}`);
  }

  await cache.put(request, response.clone());
  return response;
}

async function installAppShell() {
  const cache = await caches.open(STATIC_CACHE);

  const rootRequest = new Request("/", { cache: "reload" });
  const rootResponse = await fetch(rootRequest);

  if (!rootResponse.ok) {
    throw new Error("Precache failed: /");
  }

  const html = await rootResponse.clone().text();
  await cache.put(rootRequest, rootResponse.clone());

  await Promise.all(PRECACHE_URLS.map(url => precacheUrl(cache, url)));

  // index.html의 JS/CSS에서 시작해 JS가 참조하는 화면별 파일을 차례로 따라갑니다.
  const seen = new Set();
  let pending = [...findAssetUrls(html, { includeRelative: false })];

  while (pending.length > 0) {
    const batch = pending.filter(url => !seen.has(url));
    batch.forEach(url => seen.add(url));
    pending = [];

    const responses = await Promise.all(batch.map(url => precacheUrl(cache, url)));

    for (let index = 0; index < batch.length; index += 1) {
      if (!batch[index].endsWith(".js")) continue;

      const text = await responses[index].text();
      for (const url of findAssetUrls(text, { includeRelative: true })) {
        if (!seen.has(url)) pending.push(url);
      }
    }
  }
}

self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      (async () => {
        await installAppShell();
        await self.skipWaiting();
      })()
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
            // 설치 때 저장한 앱 파일(STATIC_CACHE)을 먼저 찾고, 없으면 실행 중 저장한 파일을 찾습니다.
            // (예전에는 RUNTIME_CACHE만 찾아서 설치 직후 오프라인으로 열면 앱 코드를 못 불러왔습니다.)
            const cached =
              (await (await caches.open(STATIC_CACHE)).match(request)) ||
              (await (await caches.open(RUNTIME_CACHE)).match(request));


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

/*
 * 배우자 입력 알림(Web Push)
 *
 * 서버가 암호화해서 보낸 알림을 받아 휴대폰 알림으로 보여주고,
 * 알림을 누르면 가계부 내역 화면을 엽니다.
 */
self.addEventListener(
  "push",
  event => {
    let data = {};

    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { body: event.data ? event.data.text() : "" };
    }

    const title = data.title || "우리 가계부";

    event.waitUntil(
      self.registration.showNotification(
        title,
        {
          body: data.body || "",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: data.tag || "moneybook",
          data: {
            url: data.url || "/?shortcut=history"
          }
        }
      )
    );
  }
);

self.addEventListener(
  "notificationclick",
  event => {
    event.notification.close();

    const targetUrl = new URL(
      event.notification.data?.url || "/?shortcut=history",
      self.location.origin
    ).href;

    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true
        });

        for (const client of windows) {
          if (new URL(client.url).origin === self.location.origin) {
            await client.focus();

            if ("navigate" in client) {
              await client.navigate(targetUrl).catch(() => undefined);
            }

            return;
          }
        }

        await self.clients.openWindow(targetUrl);
      })()
    );
  }
);
