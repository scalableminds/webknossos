import { Tree as AntdTree, type TreeProps } from "antd";
import type { BasicDataNode } from "antd/es/tree";
import { throttle } from "lodash";
import Constants from "oxalis/constants";
import { useCallback, useRef } from "react";
import type RcTree from "rc-tree";

const SCROLL_SPEED_PX = 32;
const MIN_SCROLL_AREA_HEIGHT = 48;
const SCROLL_AREA_RATIO = 10; // 1/10th of the container height

function ScrollableVirtualizedTree<T extends BasicDataNode>(
  props: TreeProps<T> & { ref: React.RefObject<RcTree> },
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
      const scrollAreaHeight = Math.max(
        MIN_SCROLL_AREA_HEIGHT,
        Math.round((boxBottom - boxTop) / SCROLL_AREA_RATIO),
      );

      if (currentTop > boxBottom - scrollAreaHeight && scrollableList) {
        scrollableList.scrollTop += SCROLL_SPEED_PX;
      }
      if (boxTop + scrollAreaHeight > currentBottom && scrollableList) {
        scrollableList.scrollTop -= SCROLL_SPEED_PX;
      }
    }, Constants.RESIZE_THROTTLE_TIME),
    [wrapperRef],
  );

  return (
    <div ref={wrapperRef}>
      <AntdTree {...props} onDragOver={onDragOver} />
    </div>
  );
}

export default ScrollableVirtualizedTree;
