import React, { useState, useEffect, useRef } from "react";
import { useStore } from "react-redux";
import type { OxalisState } from "oxalis/store";
// From https://overreacted.io/making-setinterval-declarative-with-react-hooks/
export function useInterval(
  callback: (...args: Array<any>) => any,
  delay: number | null | undefined,
) {
  const savedCallback = useRef();
  // Remember the latest callback.
  useEffect(() => {
    // @ts-expect-error ts-migrate(2322) FIXME: Type '(...args: any[]) => any' is not assignable t... Remove this comment to see the full error message
    savedCallback.current = callback;
  });
  // Set up the interval.
  useEffect(() => {
    function tick() {
      // @ts-expect-error ts-migrate(2722) FIXME: Cannot invoke an object which is possibly 'undefin... Remove this comment to see the full error message
      if (savedCallback.current != null) savedCallback.current();
    }

    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }

    return undefined;
  }, [delay]);
}
export function useFetch<T>(
  fetchFn: () => Promise<T>,
  defaultValue: T,
  dependencies: Array<any>,
): T {
  const [value, setValue] = useState(defaultValue);

  const fetchValue = async () => {
    const fetchedValue = await fetchFn();
    setValue(fetchedValue);
  };

  useEffect(() => {
    fetchValue();
  }, dependencies);
  return value;
}

/*
  Instead of recomputing derived values on every store change,
  this hook throttles such computations at a given interval.
  This is done by checking whether the store changed in a polling
  manner.
  Only use this if your component doesn't need high frequency
  updates.
 */
export function usePolledState(callback: (arg0: OxalisState) => void, interval: number = 1000) {
  const store = useStore();
  const oldState = useRef(null);
  useInterval(() => {
    const state = store.getState();

    if (oldState.current === state) {
      return;
    }

    oldState.current = state;
    callback(state);
  }, interval);
}

export function makeComponentLazy<T extends { isVisible: boolean }>(
  ComponentFn: React.ComponentType<T>,
): React.ComponentType<T> {
  return function LazyModalWrapper(props: T) {
    const [hasBeenInitialized, setHasBeenInitialized] = useState(false);
    const isVisible = props.isVisible;
    useEffect(() => {
      setHasBeenInitialized(hasBeenInitialized || isVisible);
    }, [isVisible]);

    if (isVisible || hasBeenInitialized) {
      return <ComponentFn {...props} />;
    }
    return null;
  };
}

export default {};
