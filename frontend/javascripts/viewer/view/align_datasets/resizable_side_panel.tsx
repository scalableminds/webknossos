import { clamp } from "libs/utils";
import type React from "react";
import { useEffect, useState } from "react";

const MIN_WIDTH = 260;
const DEFAULT_WIDTH = 380;
const MAX_WIDTH_RATIO = 0.7;
const KEYBOARD_STEP = 16;

function clampWidth(width: number) {
  return clamp(MIN_WIDTH, width, window.innerWidth * MAX_WIDTH_RATIO);
}

// A panel at the left edge of the page that can be resized by dragging the divider on its
// right side or by pressing the arrow keys while the divider is focused.
export function ResizableSidePanel({ children }: { children: React.ReactNode }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  // The listeners are on the window, so that dragging continues when the cursor leaves
  // the divider.
  useEffect(() => {
    if (!isResizing) {
      return;
    }
    // The panel starts at x = 0, so the cursor position is the new width.
    const onMouseMove = (event: MouseEvent) => setWidth(clampWidth(event.clientX));
    const stopResizing = () => setIsResizing(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing]);

  const onDividerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      setWidth((oldWidth) => clampWidth(oldWidth - KEYBOARD_STEP));
    } else if (event.key === "ArrowRight") {
      setWidth((oldWidth) => clampWidth(oldWidth + KEYBOARD_STEP));
    }
  };

  return (
    <>
      <div className="resizable-side-panel" style={{ width }}>
        {children}
      </div>
      <button
        type="button"
        className="resizable-side-panel-divider"
        aria-label="Resize the panel"
        title="Drag (or use the arrow keys) to resize the panel"
        onMouseDown={() => setIsResizing(true)}
        onKeyDown={onDividerKeyDown}
      />
      {/* Mouse events above an iframe don't reach this page. While dragging, this overlay
      covers the iframes so that the drag doesn't stop above them. */}
      {isResizing ? <div className="resizable-side-panel-overlay" /> : null}
    </>
  );
}
