import constants from "oxalis/constants";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { KEYBOARD_BUTTON_LOOP_INTERVAL } from "./input";

// Adapted from: https://usehooks.com/usePrevious/
export function usePrevious<T>(value: T, ignoreNullAndUndefined: boolean = false): T | null {
  // The ref object is a generic container whose current property is mutable ...
  // ... and can hold any value, similar to an instance property on a class
  const ref = useRef<T | null>(null);
  // Store current value in ref
  useEffect(() => {
    if (!ignoreNullAndUndefined || value != null) {
      ref.current = value;
    }
  }, [value, ignoreNullAndUndefined]);
  // Only re-run if value changes
  // Return previous value (happens before update in useEffect above)
  return ref.current;
}

const extractModifierState = <K extends keyof WindowEventMap>(event: WindowEventMap[K]) => ({
  // @ts-ignore
  Shift: event.shiftKey,
  // @ts-ignore
  Alt: event.altKey,
  // @ts-ignore
  Control: event.ctrlKey,
});

// Adapted from: https://gist.github.com/gragland/b61b8f46114edbcf2a9e4bd5eb9f47f5
export function useKeyPress(targetKey: "Shift" | "Alt" | "Control") {
  // State for keeping track of whether key is pressed
  const [keyPressed, setKeyPressed] = useState(false);

  // If pressed key is our target key then set to true
  function downHandler<K extends keyof WindowEventMap>(this: Window, event: WindowEventMap[K]) {
    const modifierState = extractModifierState(event);

    if (modifierState[targetKey] === undefined) {
      // The targetKey is not a modifier. Compare to the pressed key.
      if ("key" in event && event.key === targetKey) {
        pressKey();
      }
    } else if (modifierState[targetKey]) {
      // Use the modifierState as this seems to be more robust. See
      // the other comment below which describes some edge cases
      // regarding modifiers.
      pressKey();
    }
  }

  function pressKey() {
    setKeyPressed(true);
    window.addEventListener("blur", releaseKey);
  }

  function releaseKey() {
    setKeyPressed(false);
    window.removeEventListener("blur", releaseKey);
  }

  // If released key is our target key then set to false
  const upHandler = <K extends keyof WindowEventMap>(event: WindowEventMap[K]) => {
    const modifierState = extractModifierState(event);

    if (modifierState[targetKey] === undefined) {
      // The targetKey is not a modifier. Compare to the pressed key.
      if ("key" in event && event.key === targetKey) {
        releaseKey();
      }
    } else if (!modifierState[targetKey]) {
      // The targetKey is a modifier. Use the modifierState as this
      // is more robust against pressing multiple modifiers. For example,
      // on Linux, pressing Shift and then toggling Alt, will send a release
      // of the Meta key even though that key was never touched.
      releaseKey();
    }
  };

  // Add event listeners
  useEffectOnlyOnce(() => {
    window.addEventListener("keydown", downHandler);
    window.addEventListener("keyup", upHandler);
    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener("keydown", downHandler);
      window.removeEventListener("keyup", upHandler);
    };
  });
  // Empty array ensures that effect is only run on mount and unmount
  return keyPressed;
}

export function useRepeatedButtonTrigger(
  triggerCallback: (timeFactor: number, isFirst: boolean) => void,
  repeatDelay: number = KEYBOARD_BUTTON_LOOP_INTERVAL,
) {
  const [isPressed, setIsPressed] = useState(false);
  const lastTrigger = useRef<number | null>(null);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;

    if (isPressed) {
      const trigger = () => {
        timerId = setTimeout(() => {
          // The timeFactor calculation was adapted from buttonLoop() in input.ts
          const curTime = Date.now();
          // If no lastTime, assume that desired FPS is met
          const lastTime = lastTrigger.current ?? curTime - 1000 / constants.FPS;
          const elapsed = curTime - lastTime;

          triggerCallback((elapsed / 1000) * constants.FPS, lastTrigger.current == null);
          lastTrigger.current = curTime;
          trigger();
        }, repeatDelay);
      };

      trigger();
    }

    return () => {
      lastTrigger.current = null;
      clearTimeout(timerId);
    };
  }, [isPressed, triggerCallback, repeatDelay]);

  const onTouchStart = () => setIsPressed(true);
  const onTouchEnd = () => setIsPressed(false);

  return {
    // Don't do anything on click to avoid that the trigger
    // is called twice on touch start.
    onClick: () => {},
    onTouchStart,
    onTouchEnd,
  };
}

export function useSearchParams() {
  const location = useLocation();
  return Object.fromEntries(new URLSearchParams(location.search).entries());
}

export function useUpdateEvery(interval: number) {
  const [, setSeconds] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSeconds((seconds) => seconds + 1);
    }, interval);
    return () => window.clearInterval(intervalId);
  }, [interval]);
}

export function usePolling(
  callback: () => Promise<void>,
  delay: number | null,
  dependencies: React.DependencyList = [],
) {
  const savedCallback = useRef<() => Promise<void>>(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    let killed = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let animationFrameId: number | null = null;

    async function poll() {
      if (killed) return;
      await savedCallback.current();
      if (killed) return;
      if (delay != null) {
        timeoutId = setTimeout(poll2, delay);
      }
    }

    function poll2() {
      if (killed) return;
      animationFrameId = requestAnimationFrame(poll);
    }

    poll();

    return () => {
      killed = true;
      if (animationFrameId != null) cancelAnimationFrame(animationFrameId);
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [delay, ...dependencies]);
}

export function useEffectOnlyOnce(callback: () => void | (() => void)) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicitly run only once.
  useEffect(() => {
    return callback();
  }, []);
}
