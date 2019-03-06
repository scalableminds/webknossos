// @flow

import { useState, useEffect, useRef } from "react";

// From https://overreacted.io/making-setinterval-declarative-with-react-hooks/
export function useInterval(callback: Function, delay: ?number) {
  const savedCallback = useRef();

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

export default {};
