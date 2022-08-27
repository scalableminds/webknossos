import { useEffect, useRef } from "react";

export default function usePolling(callback: () => Promise<void>, delay: number | null) {
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
  }, [delay]);
}
