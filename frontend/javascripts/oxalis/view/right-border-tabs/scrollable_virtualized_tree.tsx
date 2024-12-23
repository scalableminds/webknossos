import { Tree as AntdTree, type TreeProps } from "antd";
import type { BasicDataNode } from "antd/es/tree";
import { throttle } from "lodash";
import { forwardRef, useCallback, useRef } from "react";
import type RcTree from "rc-tree";

const MIN_SCROLL_SPEED = 30;
const MAX_SCROLL_SPEED = 200;
const MIN_SCROLL_AREA_HEIGHT = 60;
const SCROLL_AREA_RATIO = 10; // 1/10th of the container height
const THROTTLE_TIME = 25;

// React.forwardRef does not support generic types, so we need to define the type of the ref separately.
function ScrollableVirtualizedTreeInner<T extends BasicDataNode>(
  props: TreeProps<T>,
  ref: React.Ref<RcTree>,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: biome is not smart enough to notice that the function needs to be re-created when wrapperRef changes.
  const onDragOver = useCallback(
    throttle((info: { event: React.DragEvent<HTMLDivElement> }) => {
      const target = info.event.target as HTMLElement;
      if (!target || !wrapperRef.current) {
        return;
      }
      const { bottom: currentBottom, top: currentTop } = target.getBoundingClientRect();
      const { bottom: boxBottom, top: boxTop } = wrapperRef.current.getBoundingClientRect();
      const scrollableList = wrapperRef.current.getElementsByClassName("ant-tree-list-holder")[0];
      if (!scrollableList) {
        return;
      }
      const scrollAreaHeight = Math.max(
        MIN_SCROLL_AREA_HEIGHT,
        Math.round((boxBottom - boxTop) / SCROLL_AREA_RATIO),
      );

      if (currentTop > boxBottom - scrollAreaHeight && scrollableList) {
        const ratioWithinScrollingArea =
          (currentTop - (boxBottom - scrollAreaHeight)) / scrollAreaHeight;
        const scrollingValue = Math.max(
          Math.round(ratioWithinScrollingArea * MAX_SCROLL_SPEED),
          MIN_SCROLL_SPEED,
        );
        scrollableList.scrollTop += scrollingValue;
      }
      if (boxTop + scrollAreaHeight > currentBottom && scrollableList) {
        const ratioWithinScrollingArea =
          (boxTop + scrollAreaHeight - currentBottom) / scrollAreaHeight;
        const scrollingValue = Math.max(
          Math.round(ratioWithinScrollingArea * MAX_SCROLL_SPEED),
          MIN_SCROLL_SPEED,
        );
        scrollableList.scrollTop -= scrollingValue;
      }
    }, THROTTLE_TIME),
    [wrapperRef],
  );

  return (
    <div ref={wrapperRef}>
      <AntdTree {...props} onDragOver={onDragOver} ref={ref} />
    </div>
  );
}

const ScrollableVirtualizedTree = forwardRef(ScrollableVirtualizedTreeInner) as <
  T extends BasicDataNode,
>(
  props: TreeProps<T> & { ref?: React.Ref<RcTree> },
) => ReturnType<typeof ScrollableVirtualizedTreeInner>;

export default ScrollableVirtualizedTree;
