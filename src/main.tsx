import {
  StrictMode
} from "react";

import {
  createRoot
} from "react-dom/client";

import App
  from "./App";

import PwaInstallPrompt
  from "./components/pwa/PwaInstallPrompt/PwaInstallPrompt";

import "./styles/tokens.css";
import "./styles/global.css";


const root =
  document.getElementById(
    "root"
  );


if (!root) {
  throw new Error(
    "root 요소를 찾을 수 없습니다."
  );
}


createRoot(
  root
).render(
  <StrictMode>
    <App />

    <PwaInstallPrompt />
  </StrictMode>
);


if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator
) {
  window.addEventListener(
    "load",
    () => {
      void navigator
        .serviceWorker
        .register(
          "/sw.js"
        )
        .then(
          registration =>
            registration.update()
        )
        .catch(
          error => {
            console.error(
              "서비스 워커 등록에 실패했습니다.",
              error
            );
          }
        );
    }
  );
}
