/** AbortSignal that fires after `ms`. Works where `AbortSignal.timeout` is missing (older Safari / WebViews). */
export function abortSignalAfter(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const id = globalThis.setTimeout(() => {
    try {
      controller.abort(new DOMException('signal timed out', 'TimeoutError'))
    } catch {
      controller.abort()
    }
  }, Math.max(0, ms))
  const { signal } = controller
  const clear = () => globalThis.clearTimeout(id)
  signal.addEventListener('abort', clear, { once: true })
  return signal
}

/**
 * Race a promise against a hard timeout.
 * With `fallback`, resolves to that value on timeout; otherwise rejects with TimeoutError.
 */
export function raceWithTimeout<T>(promise: Promise<T>, ms: number, fallback?: T): Promise<T> {
  const hasFallback = arguments.length >= 3
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      if (hasFallback) {
        resolve(fallback as T)
        return
      }
      try {
        reject(new DOMException('signal timed out', 'TimeoutError'))
      } catch {
        reject(new Error('signal timed out'))
      }
    }, Math.max(0, ms))
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) globalThis.clearTimeout(timer)
  })
}

/**
 * Soft timeout: if `promise` is still pending after `ms`, return `fallback` immediately
 * and optionally deliver the late result via `onLate`.
 */
export function softTimeoutKeepGoing<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  onLate?: (value: T) => void,
): Promise<T> {
  let settled = false
  return new Promise<T>((resolve) => {
    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, Math.max(0, ms))
    promise
      .then((value) => {
        if (settled) {
          onLate?.(value)
          return
        }
        settled = true
        globalThis.clearTimeout(timer)
        resolve(value)
      })
      .catch(() => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timer)
        resolve(fallback)
      })
  })
}
