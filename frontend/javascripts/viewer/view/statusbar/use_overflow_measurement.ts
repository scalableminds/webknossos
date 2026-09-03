import { compact } from "lodash-es";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";

type UseOverflowMeasurementParams = {
  // Determines the available width.
  containerRef: RefObject<HTMLElement | null>;
  // Always-shown siblings (e.g. the left border button, Infos, the right border
  // button) whose (margin-excluding) widths are summed and subtracted from the
  // container's width to get the width available for the measured items.
  fixedRefs: RefObject<HTMLElement | null>[];
  // Hidden row wrapping a full-size (never collapsed) measurement of every item, keyed
  // via setItemRefFactory below. Observed as a whole so that content changes (e.g. item text
  // changing) trigger a re-measurement without needing one observer per item.
  measureRowRef: RefObject<HTMLElement | null>;
  // Candidate widths for the overflow trigger (e.g. a "More" vs. an "everything is
  // hidden" label) -- the widest of these is reserved, since the actual trigger width
  // depends on the very outcome this hook computes.
  triggerMeasureRefs: RefObject<HTMLElement | null>[];
  // Keys of the items to measure, in display order.
  itemKeys: string[];
  // Reserved so that the measured items (or the trigger, once shown) never end up
  // directly touching whatever follows them.
  minGap: number;
};

type UseOverflowMeasurementResult = {
  visibleCount: number;
  // Callback-ref factory for the hidden per-item measurer elements, keyed by item key.
  setItemRefFactory: (key: string) => (el: HTMLElement | null) => void;
};

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
  const [visibleCount, setVisibleCount] = useState(itemKeys.length);

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
      // Each fixed sibling's own (margin-excluding) offsetWidth is summed up here,
      // rather than e.g. deriving the available width from container.scrollWidth minus
      // the items' width. That's because a right-aligned sibling using
      // `margin-left: auto` always expands to fill any free space -- so
      // container.scrollWidth would equal clientWidth whenever there's no overflow,
      // regardless of how many items are currently shown, making it impossible to
      // detect that there's enough room to show more of them.
      const fixedWidth = fixedRefs.reduce((sum, ref) => sum + (ref.current?.offsetWidth ?? 0), 0);
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
        // An overflow trigger will be shown, so its width is reserved up front (rather
        // than only between individual items) -- otherwise, if zero items end up
        // fitting, nothing would have verified that the trigger alone still leaves the
        // minimum gap.
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
    return () => resizeObserver.disconnect();
    // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable across
    // renders, and item/content changes are picked up via the ResizeObserver instead
    // (itemKeys is read through itemKeysRef so this can stay mount-only).
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
