export interface BrowserLifecycleCallbacks {
  onHidden?(): void;
  onOnline?(): void;
  onPageHide?(event: PageTransitionEvent): void;
  onPageShow?(event: PageTransitionEvent): void;
  onVisible?(): void;
}

const subscribers = new Set<BrowserLifecycleCallbacks>();

let installed = false;

function handleVisibilityChange(): void {
  for (const subscriber of subscribers) {
    if (document.visibilityState === "visible") {
      subscriber.onVisible?.();
      continue;
    }

    subscriber.onHidden?.();
  }
}

function handleOnline(): void {
  for (const subscriber of subscribers) {
    subscriber.onOnline?.();
  }
}

function handlePageHide(event: PageTransitionEvent): void {
  for (const subscriber of subscribers) {
    subscriber.onPageHide?.(event);
  }
}

function handlePageShow(event: PageTransitionEvent): void {
  for (const subscriber of subscribers) {
    subscriber.onPageShow?.(event);
  }
}

function installListeners(): void {
  if (
    installed ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }

  installed = true;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("online", handleOnline);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
}

function uninstallListeners(): void {
  if (
    !installed ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }

  installed = false;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("pagehide", handlePageHide);
  window.removeEventListener("pageshow", handlePageShow);
}

export function subscribeBrowserLifecycle(
  callbacks: BrowserLifecycleCallbacks,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  subscribers.add(callbacks);
  installListeners();

  return () => {
    subscribers.delete(callbacks);
    if (subscribers.size === 0) {
      uninstallListeners();
    }
  };
}
