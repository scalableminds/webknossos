import { isUserAdminOrManager } from "libs/utils";
import { type WebknossosState } from "oxalis/store";
import { useWkSelector } from "./react_hooks";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "react-redux";
import type { ArbitraryFunction } from "types/globals";
import Toast from "./toast";

// From https://overreacted.io/making-setinterval-declarative-with-react-hooks/
export function useInterval(
  callback: ArbitraryFunction,
  delay: number | null | undefined,
  ...additionalDependencies: Array<any>
) {
  const savedCallback = useRef<ArbitraryFunction>();
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

  const fetchValue = async () => {
    const fetchedValue = await fetchFn();
    setValue(fetchedValue);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchValue is recomputed every time. Therefore, it is not included in the dependencies.
  useEffect(() => {
    fetchValue();
  }, dependencies);
  return value;
}

export function useGuardedFetch<T>(
  fetchFn: () => Promise<T>,
  defaultValue: T,
  dependencies: Array<any>,
  toastErrorMessage: string,
): [T, boolean] {
  /*
   * Similar to useFetch, this hook loads something asynchronously and exposes that value.
   * Additionally, if fetchFn should fail, toastErrorMessage is shown as a toast error.
   * Also, the function returns a tuple consistent of:
   * - the value T
   * - an isLoading boolean
   */

  const [isLoading, setIsLoading] = useState(false);
  const [value, setValue] = useState<T>(defaultValue);

  async function loadData() {
    setIsLoading(true);
    try {
      const _value = await fetchFn();
      setValue(_value);
    } catch (err) {
      console.error(err);
      Toast.error(toastErrorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies(loadData):
  useEffect(() => {
    loadData();
  }, dependencies);

  return [value, isLoading];
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

export default {};
