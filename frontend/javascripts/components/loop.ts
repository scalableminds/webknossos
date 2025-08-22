import window from "libs/window";
import { useCallback, useEffect } from "react";

type LoopProps = {
  interval: number;
  onTick: (...args: Array<any>) => any;
};

export default function Loop({ interval, onTick }: LoopProps) {
  const _onTick = useCallback(onTick, []);

  useEffect(() => {
    const intervalId = window.setInterval(_onTick, interval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [interval, _onTick]);

  return null;
}
