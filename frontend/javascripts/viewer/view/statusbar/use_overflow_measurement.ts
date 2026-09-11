import { compact } from "lodash-es";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

type UseOverflowMeasurementParams = {
  // Provides the available width.
  containerRef: RefObject<HTMLElement | null>;
  // Always-shown siblings whose widths are subtracted from the available width.
  fixedRefs: RefObject<HTMLElement | null>[];
  // Hidden row holding a full-size measurement of every item (keyed via
  // setItemRefFactory). Observed as a whole, so that content changes trigger a
  // re-measurement without needing one observer per item.
  measureRowRef: RefObject<HTMLElement | null>;
  // Possible widths of the overflow trigger; the widest one is reserved, since the
  // actual label depends on this hook's outcome.
  triggerMeasureRefs: RefObject<HTMLElement | null>[];
  // Keys of the items to measure, in display order.
  itemKeys: string[];
  minGap: number;
};

type UseOverflowMeasurementResult = {
  visibleCount: number;
  // Callback-ref factory for the hidden per-item measurer elements, keyed by item key.
  setItemRefFactory: (key: string) => (el: HTMLElement | null) => void;
};

export const FIXED_WIDTH_MEMORY_MS = 3000;

export type WidthSample = { timestampMs: number; width: number };

/**
 * Records a width sample for a sliding-window maximum, so that siblings which change
 * width on their own (e.g. the mouse position) don't make the item count oscillate.
 * Samples that can no longer become the maximum are dropped right away, so the result
 * is sorted widest-first and the next-widest takes over once the widest expires.
 */
export function recordWidthSample(samples: WidthSample[], newSample: WidthSample): WidthSample[] {
  const stillRelevant = samples.filter(
    (sample) =>
      sample.width > newSample.width &&
      sample.timestampMs > newSample.timestampMs - FIXED_WIDTH_MEMORY_MS,
  );
  return [...stillRelevant, newSample];
}

/**
 * Determines how many of `itemKeys` (in order) fit into the space that's left over in
 * `containerRef` after `fixedRefs` and `minGap`, reserving room for an overflow trigger
 * (the widest of `triggerMeasureRefs`) whenever not everything fits.
 */
export function useOverflowMeasurement({
  containerRef,
  fixedRefs,
  measureRowRef,
  triggerMeasureRefs,
  itemKeys,
  minGap,
}: UseOverflowMeasurementParams): UseOverflowMeasurementResult {
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const itemKeysRef = useRef(itemKeys);
  itemKeysRef.current = itemKeys;
  const fixedWidthSamplesRef = useRef<WidthSample[]>([]);
  const decayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleCount, setVisibleCount] = useState(itemKeys.length);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only; refs are stable and content changes are picked up by the ResizeObserver (itemKeys is read via itemKeysRef).
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measureRow = measureRowRef.current;
    if (container == null || measureRow == null) {
      return;
    }
    if (fixedRefs.some((ref) => ref.current == null)) {
      return;
    }
    if (triggerMeasureRefs.some((ref) => ref.current == null)) {
      return;
    }

    const recompute = () => {
      // The widths are summed up manually instead of using container.scrollWidth: a
      // right-aligned sibling with `margin-left: auto` always fills the free space, so
      // scrollWidth would equal clientWidth no matter how many items are shown.
      const currentFixedWidth = fixedRefs.reduce(
        (sum, ref) => sum + (ref.current?.offsetWidth ?? 0),
        0,
      );
      // Use the widest recent width so that self-changing readouts don't toggle items.
      const now = performance.now();
      const samples = recordWidthSample(fixedWidthSamplesRef.current, {
        timestampMs: now,
        width: currentFixedWidth,
      });
      fixedWidthSamplesRef.current = samples;
      const fixedWidth = samples[0].width;

      // The ResizeObserver only fires on actual changes, so the expiry has to be
      // scheduled explicitly -- otherwise the width would never shrink back.
      if (decayTimeoutRef.current != null) {
        clearTimeout(decayTimeoutRef.current);
        decayTimeoutRef.current = null;
      }
      if (samples.length > 1) {
        const msUntilWidestExpires = samples[0].timestampMs + FIXED_WIDTH_MEMORY_MS - now;
        decayTimeoutRef.current = setTimeout(() => recompute(), Math.max(msUntilWidestExpires, 0));
      }

      const availableForItems = container.clientWidth - fixedWidth - minGap;
      const triggerWidth = Math.max(
        ...triggerMeasureRefs.map((ref) => ref.current?.offsetWidth ?? 0),
        0,
      );

      const currentItemKeys = itemKeysRef.current;
      const itemWidths = currentItemKeys.map((key) => itemRefs.current.get(key)?.offsetWidth ?? 0);
      const totalItemsWidth = itemWidths.reduce((sum, width) => sum + width, 0);

      let count: number;
      if (totalItemsWidth <= availableForItems) {
        // Everything fits -- no overflow trigger needed.
        count = currentItemKeys.length;
      } else {
        // Reserve the trigger width up front: otherwise, when no item fits at all,
        // nothing would have checked that the trigger still leaves the minimum gap.
        const budget = availableForItems - triggerWidth;
        let usedWidth = 0;
        count = 0;
        for (let i = 0; i < itemWidths.length; i++) {
          if (usedWidth + itemWidths[i] > budget) {
            break;
          }
          usedWidth += itemWidths[i];
          count++;
        }
      }
      setVisibleCount(count);
    };
    recompute();

    const resizeObserver = new ResizeObserver(recompute);
    const elementsToObserve = [
      container,
      ...compact(fixedRefs.map((ref) => ref.current)),
      measureRow,
    ];
    for (const element of elementsToObserve) {
      resizeObserver.observe(element);
    }
    return () => {
      resizeObserver.disconnect();
      if (decayTimeoutRef.current != null) {
        clearTimeout(decayTimeoutRef.current);
      }
    };
  }, []);

  const setItemRefFactory = (key: string) => (el: HTMLElement | null) => {
    if (el) {
      itemRefs.current.set(key, el);
    } else {
      itemRefs.current.delete(key);
    }
  };

  return { visibleCount, setItemRefFactory };
}
