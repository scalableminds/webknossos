// Split out from save_mutex_saga.tsx so that save_mutex_saga.spec.ts can mock this
// module to use much shorter intervals, without affecting the timing that every
// other test file relies on (the mutex-acquiring saga runs in the background for
// every test via the root saga, not just tests that import save_mutex_saga directly).

// Also refer to application.conf where annotation.mutex.expiryTime is defined
// (typically, 2 minutes).
export const ACQUIRE_MUTEX_INTERVAL = import.meta.env.MODE === "test" ? 1 * 1000 : 60 * 1000;
export const DELAY_AFTER_FAILED_MUTEX_FETCH = import.meta.env.MODE === "test" ? 1 * 1000 : 10 * 1000;
export const INITIAL_BACKOFF_TIME = 750;
