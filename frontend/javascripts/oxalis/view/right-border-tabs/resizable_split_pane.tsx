import { Divider } from "antd";
import type React from "react";
import { useEffect, useRef, useState } from "react";

// todop: change back to 100?
// should this be memorized per user? local storage maybe? then, it's sync and device specific
const INITIAL_HEIGHT = 400;

export function ResizableSplitPane({
  firstChild,
  secondChild,
}: { firstChild: React.ReactElement; secondChild: React.ReactElement | null }) {
  const [heightForSecondChild, setHeightForSecondChild] = useState(INITIAL_HEIGHT);
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
      const newHeightForSecondChild =
        containerRect.height - newHeightForFirstChild - dividerRef.current.clientHeight;

      if (newHeightForFirstChild > 0 && newHeightForSecondChild > 0) {
        setHeightForSecondChild(newHeightForSecondChild);
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
      <div className="child-2" style={{ height: heightForSecondChild }}>
        {secondChild}
      </div>
    </div>
  );
}
