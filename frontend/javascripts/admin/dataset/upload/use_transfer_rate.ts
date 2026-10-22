import { useEffect, useRef, useState } from "react";

// The speed is averaged over this window, so that it doesn't jump with every chunk.
const AVERAGING_WINDOW = 5000; // ms
// The time left is only shown once the speed is averaged over (almost) a full window.
const MIN_WINDOW_FOR_TIME_LEFT = 0.8 * AVERAGING_WINDOW; // ms
// Without progress events (e.g. a stalled network or a paused upload), the speed is still
// re-sampled in this interval, so that it decays instead of showing the last value forever.
const IDLE_SAMPLE_INTERVAL = 1000; // ms

type Sample = { time: number; bytes: number };

export type TransferRate = {
  bytesPerSecond: number;
  secondsLeft: number | null;
};

/** Derives a smoothed upload speed and the remaining time from the bytes sent so far. */
export function useTransferRate(
  bytesSent: number,
  bytesTotal: number,
  isActive: boolean,
): TransferRate | null {
  const samplesRef = useRef<Sample[]>([]);
  const [rate, setRate] = useState<TransferRate | null>(null);

  useEffect(() => {
    const addSample = () => {
      const now = performance.now();
      const samples = samplesRef.current.filter((sample) => now - sample.time <= AVERAGING_WINDOW);
      samples.push({ time: now, bytes: bytesSent });
      samplesRef.current = samples;

      const oldest = samples[0];
      const elapsedTime = now - oldest.time;
      if (elapsedTime === 0) return;
      // The progress can go back when a chunk is retried, which must not result in a negative speed.
      const bytesPerSecond = Math.max(0, ((bytesSent - oldest.bytes) / elapsedTime) * 1000);
      const secondsLeft =
        elapsedTime >= MIN_WINDOW_FOR_TIME_LEFT && bytesPerSecond > 0
          ? (bytesTotal - bytesSent) / bytesPerSecond
          : null;
      setRate({ bytesPerSecond, secondsLeft });
    };

    addSample();
    if (!isActive) return;
    const intervalId = setInterval(addSample, IDLE_SAMPLE_INTERVAL);
    return () => clearInterval(intervalId);
  }, [bytesSent, bytesTotal, isActive]);

  return rate;
}
