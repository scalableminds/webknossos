import { Tree as AntdTree, type GetRef, type TreeProps } from "antd";
import type { BasicDataNode } from "antd/es/tree";
import throttle from "lodash-es/throttle";
import { useMemo, useState } from "react";

const MIN_SCROLL_SPEED = 30;
const MAX_SCROLL_SPEED = 200;
const MIN_SCROLL_AREA_HEIGHT = 60;
const SCROLL_AREA_RATIO = 10; // 1/10th of the container height
const THROTTLE_TIME = 25;

function ScrollableVirtualizedTree<T extends BasicDataNode>(
  props: TreeProps<T> & { ref?: React.Ref<GetRef<typeof AntdTree>> },
) {
  const { ref, ...restProps } = props;
  // Kept in state (via a callback ref) so that the drag handler is re-created once the
  // wrapper is mounted.
  const [wrapperElement, setWrapperElement] = useState<HTMLDivElement | null>(null);
  const onDragOver = useMemo(
    () =>
      throttle((info: { event: React.DragEvent<HTMLDivElement> }) => {
        const target = info.event.target as HTMLElement;
        if (!target || !wrapperElement) {
          return;
        }
        const { bottom: currentBottom, top: currentTop } = target.getBoundingClientRect();
        const { bottom: boxBottom, top: boxTop } = wrapperElement.getBoundingClientRect();
        const scrollableList = wrapperElement.getElementsByClassName("ant-tree-list-holder")[0];
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
    [wrapperElement],
  );

  return (
    <div ref={setWrapperElement}>
      <AntdTree {...restProps} onDragOver={onDragOver} ref={ref} />
    </div>
  );
}

export default ScrollableVirtualizedTree;
