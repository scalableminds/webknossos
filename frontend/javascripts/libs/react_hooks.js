// @flow
import { useState, useEffect, useRef } from "react";

// Adapted from: https://usehooks.com/usePrevious/
export function usePrevious<T>(value: T): ?T {
  // The ref object is a generic container whose current property is mutable ...
  // ... and can hold any value, similar to an instance property on a class
  const ref = useRef<?T>(null);

  // Store current value in ref
  useEffect(() => {
    ref.current = value;
  }, [value]); // Only re-run if value changes

  // Return previous value (happens before update in useEffect above)
  return ref.current;
}

const extractModifierState = event => ({
  Shift: event.shiftKey,
  Alt: event.altKey,
  Control: event.ctrlKey,
});

// Adapted from: https://gist.github.com/gragland/b61b8f46114edbcf2a9e4bd5eb9f47f5
export function useKeyPress(targetKey: string) {
  // State for keeping track of whether key is pressed
  const [keyPressed, setKeyPressed] = useState(false);

  // If pressed key is our target key then set to true
  function downHandler(event) {
    const modifierState = extractModifierState(event);

    if (modifierState[targetKey] === undefined) {
      // The targetKey is not a modifier. Compare to the pressed key.
      if (event.key === targetKey) {
        pressKey();
      }
    } else {
      // Use the modifierState as this seems to be more robust. See
      // the other comment below which describes some edge cases
      // regarding modifiers.
      if (modifierState[targetKey]) {
        pressKey();
      }
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
  const upHandler = event => {
    const modifierState = extractModifierState(event);

    if (modifierState[targetKey] === undefined) {
      // The targetKey is not a modifier. Compare to the pressed key.
      if (event.key === targetKey) {
        releaseKey();
      }
    } else {
      // The targetKey is a modifier. Use the modifierState as this
      // is more robust against pressing multiple modifiers. For example,
      // on Linux, pressing Shift and then toggling Alt, will send a release
      // of the Meta key even though that key was never touched.
      if (!modifierState[targetKey]) {
        releaseKey();
      }
    }
  };

  // Add event listeners
  useEffect(() => {
    window.addEventListener("keydown", downHandler);
    window.addEventListener("keyup", upHandler);
    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener("keydown", downHandler);
      window.removeEventListener("keyup", upHandler);
    };
  }, []); // Empty array ensures that effect is only run on mount and unmount

  return keyPressed;
}
