import window from "libs/window";
import { useEffect } from "react";

type LoopProps = {
  interval: number;
  onTick: (...args: Array<any>) => any;
};

export default function Loop({ interval, onTick }: LoopProps) {
  useEffect(() => {
    const intervalId = window.setInterval(onTick, interval);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [interval, onTick]);

  return null;
}
