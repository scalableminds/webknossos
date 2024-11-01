import { Tree as AntdTree, type TreeProps } from "antd";
import type { BasicDataNode } from "antd/es/tree";
import { throttle } from "lodash";
import Constants from "oxalis/constants";
import { useCallback, useRef } from "react";
import type RcTree from "rc-tree";

function ScrollableVirtualizedTree<T extends BasicDataNode>(
  props: TreeProps<T> & { ref: React.RefObject<RcTree> },
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  const onDragOver = useCallback(
    throttle((info: { event: React.DragEvent<HTMLDivElement> }) => {
      const target = info.event.target as HTMLElement;
      if (!target || !wrapperRef.current) {
        return;
      }
      const { bottom: currentBottom, top: currentTop } = target.getBoundingClientRect();
      const { bottom: boxBottom, top: boxTop } = wrapperRef.current.getBoundingClientRect();
      const scrollableList = wrapperRef.current.getElementsByClassName("ant-tree-list-holder")[0];
      const scrollAreaHeight = Math.max(48, Math.round((boxBottom - boxTop) / 10));

      if (currentTop > boxBottom - scrollAreaHeight && scrollableList) {
        scrollableList.scrollTop += +32;
      }
      if (boxTop + scrollAreaHeight > currentBottom && scrollableList) {
        scrollableList.scrollTop -= 32;
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
