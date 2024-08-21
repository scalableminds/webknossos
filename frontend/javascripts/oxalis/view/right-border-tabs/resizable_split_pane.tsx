import { Divider } from "antd";
import React, { useEffect, useRef, useState } from "react";

export function ResizableSplitPane({
  firstChild,
  secondChild,
}: { firstChild: React.ReactElement; secondChild: React.ReactElement | null }) {
  const [maxHeightForSecondChild, setMaxHeightForSecondChild] = useState(400);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || containerRef.current == null || dividerRef.current == null)
        return;

      const DIVIDER_HEIGHT = 22;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newHeightForFirstChild = e.clientY - containerRect.top - DIVIDER_HEIGHT / 2;
      const newMaxHeightForSecondChild =
        containerRect.height - newHeightForFirstChild - dividerRef.current.clientHeight;

      if (newHeightForFirstChild > 0 && newMaxHeightForSecondChild > 0) {
        setMaxHeightForSecondChild(newMaxHeightForSecondChild);
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "default";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = () => {
    isResizingRef.current = true;
    document.body.style.cursor = "row-resize";
  };

  if (secondChild == null) {
    return firstChild;
  }

  return (
    <div ref={containerRef} className="resizable-two-split-pane">
      <div className="child-1">{firstChild}</div>
      <div ref={dividerRef} onMouseDown={handleMouseDown} className="resizable-divider">
        <Divider />
      </div>
      <div className="child-2" style={{ maxHeight: maxHeightForSecondChild }}>
        {secondChild}
      </div>
    </div>
  );
}
