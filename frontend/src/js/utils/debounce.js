// =============================================================================
// ZAMORIN CAFE ERP — HIGH-PERFORMANCE DEBOUNCE & THROTTLE UTILITIES
// Eliminates layout thrashing, rapid-fire search re-renders, and keystroke lag.
// =============================================================================

/**
 * Standard debouncing wrapper.
 * Delays invoking func until after wait milliseconds have elapsed since the last time it was invoked.
 *
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds (default: 250ms)
 * @param {boolean} immediate - Trigger on leading edge
 * @returns {Function} debounced function with .cancel() and .flush()
 */
export function debounce(func, wait = 250, immediate = false) {
  let timeout = null;
  let lastArgs = null;
  let lastThis = null;

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;

    const callNow = immediate && !timeout;

    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      if (!immediate) {
        func.apply(lastThis, lastArgs);
      }
    }, wait);

    if (callNow) {
      func.apply(lastThis, lastArgs);
    }
  }

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  debounced.flush = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
      func.apply(lastThis, lastArgs);
    }
  };

  return debounced;
}

/**
 * RequestAnimationFrame throttled callback.
 * Ensures DOM mutations and redraws sync smoothly with the display refresh rate (60-120fps).
 *
 * @param {Function} callback - Function to run on next animation frame
 * @returns {Function} throttled function with .cancel()
 */
export function rafThrottle(callback) {
  let rafId = null;

  function throttled(...args) {
    if (rafId !== null) return;

    rafId = requestAnimationFrame(() => {
      rafId = null;
      callback(...args);
    });
  }

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  return throttled;
}
