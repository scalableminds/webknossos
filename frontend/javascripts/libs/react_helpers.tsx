import { isUserAdminOrManager } from "libs/utils";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "react-redux";
import type { ArbitraryFunction } from "types/type_utils";
import type { WebknossosState } from "viewer/store";
import { useWkSelector } from "./react_hooks";

// From https://overreacted.io/making-setinterval-declarative-with-react-hooks/
export function useInterval(
  callback: ArbitraryFunction,
  delay: number | null | undefined,
  ...additionalDependencies: Array<any>
) {
  const savedCallback = useRef<ArbitraryFunction>(null);
  // Remember the latest callback.
  useEffect(() => {
    savedCallback.current = callback;
  });
  // Set up the interval.
  useEffect(() => {
    function tick() {
      if (savedCallback.current != null) savedCallback.current();
    }

    if (delay !== null) {
      const id = setInterval(tick, delay);
      return () => clearInterval(id);
    }

    return undefined;
  }, [delay, ...additionalDependencies]);
}
export function useFetch<T>(
  fetchFn: () => Promise<T>,
  defaultValue: T,
  dependencies: Array<any>,
): T {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    // Ignore the result if the dependencies changed (or the component unmounted) in the
    // meantime. Otherwise, a slow, outdated request could overwrite a newer value.
    let isCurrent = true;
    fetchFn().then((fetchedValue) => {
      if (isCurrent) {
        setValue(fetchedValue);
      }
    });
    return () => {
      isCurrent = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: fetchFn is recomputed every time. Therefore, it is not included in the dependencies.
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
export function usePolledState(callback: (arg0: WebknossosState) => void, interval: number = 1000) {
  const store = useStore<WebknossosState>();
  const oldState = useRef<WebknossosState | null>(null);
  useInterval(() => {
    const state = store.getState();

    if (oldState.current === state) {
      return;
    }

    oldState.current = state;
    callback(state);
  }, interval);
}

export function makeComponentLazy<T extends { isOpen: boolean }>(
  ComponentFn: React.ComponentType<T>,
): React.ComponentType<T> {
  return function LazyModalWrapper(props: T) {
    const [hasBeenInitialized, setHasBeenInitialized] = useState(false);
    const isOpen = props.isOpen;
    // biome-ignore lint/correctness/useExhaustiveDependencies: Only initialize once open state changes.
    useEffect(() => {
      setHasBeenInitialized(hasBeenInitialized || isOpen);
    }, [isOpen]);

    if (isOpen || hasBeenInitialized) {
      return <ComponentFn {...props} />;
    }
    return null;
  };
}

export function useIsActiveUserAdminOrManager() {
  const user = useWkSelector((state) => state.activeUser);
  return user != null && isUserAdminOrManager(user);
}
