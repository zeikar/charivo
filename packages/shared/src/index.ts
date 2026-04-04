export const CHARIVO_VERSION = "0.0.0";

export const DEFAULT_CONFIG = {
  maxMessages: 100,
  responseTimeout: 30000,
  retryAttempts: 3,
} as const;

export function generateId(): string {
  let id = "";

  while (id.length < 9) {
    id += Math.random().toString(36).slice(2);
  }

  return id.slice(0, 9);
}

export function formatTimestamp(date: Date): string {
  return date.toISOString();
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
