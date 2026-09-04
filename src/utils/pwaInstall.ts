type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

export type PwaInstallState = {
  installed: boolean;
  nativeAvailable: boolean;
  iosSafari: boolean;
};

export type PwaInstallResult =
  | "accepted"
  | "dismissed"
  | "unavailable";

let initialized = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let state: PwaInstallState = {
  installed: false,
  nativeAvailable: false,
  iosSafari: false
};

const listeners = new Set<
  (nextState: PwaInstallState) => void
>();

function isStandalone() {
  const displayModeStandalone =
    window.matchMedia(
      "(display-mode: standalone)"
    ).matches;

  const navigatorStandalone =
    Boolean(
      (
        navigator as Navigator & {
          standalone?: boolean;
        }
      ).standalone
    );

  return (
    displayModeStandalone ||
    navigatorStandalone
  );
}

function isIosSafariInstallCandidate() {
  const userAgent = navigator.userAgent;

  const isIos =
    /iPad|iPhone|iPod/i.test(
      userAgent
    ) ||
    (
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1
    );

  if (!isIos) return false;

  const isWebKit =
    /WebKit/i.test(userAgent);

  const isOtherIosBrowser =
    /CriOS|FxiOS|EdgiOS|OPiOS/i.test(
      userAgent
    );

  return (
    isWebKit &&
    !isOtherIosBrowser
  );
}

function publish() {
  const snapshot = { ...state };

  listeners.forEach(
    listener => listener(snapshot)
  );
}

function refreshInstalledState() {
  const installed = isStandalone();

  if (installed === state.installed) {
    return;
  }

  state = {
    ...state,
    installed
  };

  if (installed) {
    deferredPrompt = null;
    state = {
      ...state,
      nativeAvailable: false
    };
  }

  publish();
}

export function initializePwaInstall() {
  if (
    initialized ||
    typeof window === "undefined"
  ) {
    return;
  }

  initialized = true;
  state = {
    installed: isStandalone(),
    nativeAvailable: false,
    iosSafari:
      isIosSafariInstallCandidate()
  };

  window.addEventListener(
    "beforeinstallprompt",
    event => {
      event.preventDefault();

      deferredPrompt =
        event as BeforeInstallPromptEvent;

      state = {
        ...state,
        nativeAvailable: true
      };

      publish();
    }
  );

  window.addEventListener(
    "appinstalled",
    () => {
      deferredPrompt = null;
      state = {
        ...state,
        installed: true,
        nativeAvailable: false
      };
      publish();
    }
  );

  const mediaQuery =
    window.matchMedia(
      "(display-mode: standalone)"
    );

  mediaQuery.addEventListener(
    "change",
    refreshInstalledState
  );

  window.addEventListener(
    "pageshow",
    refreshInstalledState
  );
}

export function getPwaInstallState() {
  initializePwaInstall();
  return { ...state };
}

export function subscribePwaInstall(
  listener: (
    nextState: PwaInstallState
  ) => void
) {
  initializePwaInstall();

  listeners.add(listener);
  listener({ ...state });

  return () => {
    listeners.delete(listener);
  };
}

export async function requestPwaInstall():
Promise<PwaInstallResult> {
  initializePwaInstall();

  if (
    state.installed ||
    !deferredPrompt
  ) {
    return "unavailable";
  }

  const prompt = deferredPrompt;

  await prompt.prompt();
  const choice = await prompt.userChoice;

  deferredPrompt = null;
  state = {
    ...state,
    nativeAvailable: false
  };
  publish();

  return choice.outcome;
}
