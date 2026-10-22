import { useEffect, useRef, useState } from "react";

// The speed is averaged over this window, so that it doesn't jump with every chunk.
const AVERAGING_WINDOW = 5000; // ms
// The time left is only shown once the speed is averaged over (almost) a full window.
const MIN_WINDOW_FOR_TIME_LEFT = 0.8 * AVERAGING_WINDOW; // ms

type Sample = { time: number; bytes: number };

export type TransferRate = {
  bytesPerSecond: number;
  secondsLeft: number | null;
};

/** Derives a smoothed upload speed and the remaining time from the bytes sent so far. */
export function useTransferRate(bytesSent: number, bytesTotal: number): TransferRate | null {
  const samplesRef = useRef<Sample[]>([]);
  const [rate, setRate] = useState<TransferRate | null>(null);

  useEffect(() => {
    const now = performance.now();
    const samples = samplesRef.current.filter((sample) => now - sample.time <= AVERAGING_WINDOW);
    samples.push({ time: now, bytes: bytesSent });
    samplesRef.current = samples;

    const oldest = samples[0];
    const elapsedTime = now - oldest.time;
    if (elapsedTime === 0) return;
    const bytesPerSecond = ((bytesSent - oldest.bytes) / elapsedTime) * 1000;
    const secondsLeft =
      elapsedTime >= MIN_WINDOW_FOR_TIME_LEFT && bytesPerSecond > 0
        ? (bytesTotal - bytesSent) / bytesPerSecond
        : null;
    setRate({ bytesPerSecond, secondsLeft });
  }, [bytesSent, bytesTotal]);

  return rate;
}
