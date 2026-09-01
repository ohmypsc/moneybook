const CACHE_PREFIX =
  "moneybook-static-";

const CACHE_NAME =
  `${CACHE_PREFIX}v1`;


const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-512.png"
];


self.addEventListener(
  "install",
  event => {
    event.waitUntil(
      caches
        .open(
          CACHE_NAME
        )
        .then(
          cache =>
            cache.addAll(
              APP_SHELL
            )
        )
        .then(
          () =>
            self.skipWaiting()
        )
    );
  }
);


self.addEventListener(
  "activate",
  event => {
    event.waitUntil(
      caches
        .keys()
        .then(
          cacheNames =>
            Promise.all(
              cacheNames
                .filter(
                  cacheName =>
                    cacheName.startsWith(
                      CACHE_PREFIX
                    ) &&
                    cacheName !==
                      CACHE_NAME
                )
                .map(
                  cacheName =>
                    caches.delete(
                      cacheName
                    )
                )
            )
        )
        .then(
          () =>
            self.clients.claim()
        )
    );
  }
);


self.addEventListener(
  "fetch",
  event => {
    const request =
      event.request;


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


    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }


    /*
     * 가계부 API 응답은 절대로 캐시하지 않습니다.
     *
     * 부부 중 한 사람이 입력하거나 수정한 내용이
     * 다른 사람에게 오래된 데이터로 보이는 일을
     * 막기 위한 가장 중요한 규칙입니다.
     */
    if (
      url.pathname ===
        "/api" ||
      url.pathname.startsWith(
        "/api/"
      )
    ) {
      return;
    }


    event.respondWith(
      (
        async () => {
          const cache =
            await caches.open(
              CACHE_NAME
            );


          try {
            /*
             * 온라인에서는 항상 서버 파일을 먼저 확인합니다.
             *
             * 새 버전을 배포했을 때 예전 HTML이나 JS가
             * 계속 남는 문제를 줄이기 위한 방식입니다.
             */
            const response =
              await fetch(
                request
              );


            if (
              response.ok
            ) {
              await cache.put(
                request,
                response.clone()
              );
            }


            return response;

          } catch (error) {
            /*
             * 인터넷 연결이 안 될 때만
             * 이전에 저장한 정적 파일을 사용합니다.
             */
            const cachedResponse =
              await cache.match(
                request
              );


            if (
              cachedResponse
            ) {
              return cachedResponse;
            }


            /*
             * SPA 내부 주소로 직접 들어온 경우
             * 마지막으로 저장된 앱 첫 화면을 사용합니다.
             */
            if (
              request.mode ===
              "navigate"
            ) {
              const appShell =
                await cache.match(
                  "/"
                );


              if (
                appShell
              ) {
                return appShell;
              }
            }


            throw error;
          }
        }
      )()
    );
  }
);
