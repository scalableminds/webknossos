import eraserPointedSolidBorderCursor from "@images/cursors/eraser-pointed-solid-border.svg";
import eraserSolidBorderCursor from "@images/cursors/eraser-solid-border.svg";
import eyeDropperSolidBorderCursor from "@images/cursors/eye-dropper-solid-border.svg";
import fillPointedSolidBorderCursor from "@images/cursors/fill-pointed-solid-border.svg";
import lassoPointedSolidBorderCursor from "@images/cursors/lasso-pointed-solid-border.svg";
import paintBrushSolidBorderCursor from "@images/cursors/paint-brush-solid-border.svg";
import rulerPointedBorderCursor from "@images/cursors/ruler-pointed-border.svg";
import { useEffectOnlyOnce, useKeyPress, useWkSelector } from "libs/react_hooks";
import { sleep, waitForCondition } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import type * as React from "react";
import { useRef } from "react";
import type { Rect, Viewport, ViewportRects } from "viewer/constants";
import { ArbitraryViewport, ArbitraryViews, OrthoViews } from "viewer/constants";
import {
  AnnotationTool,
  type AnnotationToolId,
  adaptActiveToolToShortcuts,
} from "viewer/model/accessors/tool_accessor";
import { setInputCatcherRects } from "viewer/model/actions/view_mode_actions";
import Store from "viewer/store";
import makeRectRelativeToCanvas from "viewer/view/layouting/layout_canvas_adapter";
import Scalebar from "viewer/view/scalebar";
import ViewportStatusIndicator from "viewer/view/viewport_status_indicator";

const emptyViewportRect = {
  top: 0,
  left: 0,
  width: 0,
  height: 0,
};

function ignoreContextMenu(event: React.MouseEvent) {
  // hide context menu, while right-clicking a canvas
  event.preventDefault();
}

// Is able to make the input catcher a square (if makeQuadratic is true)
// and returns its position within the document relative to the rendering canvas
function adaptInputCatcher(inputCatcherDOM: HTMLElement, makeQuadratic: boolean): Rect {
  const noneOverflowWrapper = inputCatcherDOM.closest(".flexlayout-dont-overflow");

  if (!noneOverflowWrapper) {
    return {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    };
  }

  // If the inputcatcher does not need to be quadratic, the extent is handled by css automatically.
  if (makeQuadratic) {
    const getQuadraticExtent = () => {
      let { width, height } = noneOverflowWrapper.getBoundingClientRect();
      // These values should be floored, so that the rendered area does not overlap
      // with the containers.
      width = Math.floor(width);
      height = Math.floor(height);
      const extent = Math.min(width, height);
      return [extent, extent];
    };

    const [width, height] = getQuadraticExtent();
    inputCatcherDOM.style.width = `${width}px`;
    inputCatcherDOM.style.height = `${height}px`;
  }

  return makeRectRelativeToCanvas(inputCatcherDOM.getBoundingClientRect());
}

const renderedInputCatchers = new Map();

export async function initializeInputCatcherSizes() {
  // In an interval of 100 ms we check whether the input catchers can be initialized
  const pollInterval = 100;
  await waitForCondition(() => {
    if (renderedInputCatchers.size === 0) {
      return false;
    }
    if (renderedInputCatchers.has("TDView")) {
      // If (and only if) the 3D viewport is visible (e.g., it might be invisible
      // due to another tab being maximized), we need to do an isNaN check here
      // to await proper initialization.
      // Otherwise, the initial zoom value of the 3D viewport would be flaky.
      const { tdCamera } = Store.getState().viewModeData.plane;
      return !Number.isNaN(tdCamera.left);
    }

    return true;
  }, pollInterval);
  // Without this sleep, maximized viewports are not rendered correctly on page load.
  await sleep(50);
  recalculateInputCatcherSizes();
}

export function recalculateInputCatcherSizes() {
  const viewportRects: Record<string, Rect> = {
    PLANE_XY: emptyViewportRect,
    PLANE_YZ: emptyViewportRect,
    PLANE_XZ: emptyViewportRect,
    TDView: emptyViewportRect,
  };

  for (const [viewportID, inputCatcher] of renderedInputCatchers.entries()) {
    const makeQuadratic = viewportID === ArbitraryViewport;
    const rect = adaptInputCatcher(inputCatcher, makeQuadratic);
    viewportRects[viewportID] = rect;
  }

  // Clicking on a viewport will trigger a FlexLayout model change event if
  // the click changes the focus from one tab to another.
  // Since the mere click does not change the size of the input catchers,
  // we want to avoid the following set action, as the corresponding reducer
  // will re-calculate the zoom ranges for the available magnifications
  // (which is expensive and unnecessary).
  if (!isEqual(viewportRects, Store.getState().viewModeData.plane.inputCatcherRects)) {
    Store.dispatch(setInputCatcherRects(viewportRects as ViewportRects));
  }
}

const cursorForTool: Record<AnnotationToolId, string> = {
  MOVE: "move",
  SKELETON: "crosshair",
  BRUSH: `url("${paintBrushSolidBorderCursor}") 0 10,auto`,
  ERASE_BRUSH: `url("${eraserSolidBorderCursor}") 0 8,auto`,
  TRACE: `url("${lassoPointedSolidBorderCursor}") 0 14,auto`,
  ERASE_TRACE: `url("${eraserPointedSolidBorderCursor}") 0 16,auto`,
  FILL_CELL: `url("${fillPointedSolidBorderCursor}") 0 16,auto`,
  VOXEL_PIPETTE: `url("${eyeDropperSolidBorderCursor}") 0 12,auto`,
  BOUNDING_BOX: "copy",
  QUICK_SELECT: "crosshair",
  PROOFREAD: "crosshair",
  LINE_MEASUREMENT: `url("${rulerPointedBorderCursor}") 0 14,auto`,
  AREA_MEASUREMENT: `url("${lassoPointedSolidBorderCursor}") 0 14,auto`,
};

function InputCatcher({
  viewportID,
  children,
  displayScalebars,
  isBlocked,
}: {
  viewportID: Viewport;
  children?: React.ReactNode;
  displayScalebars?: boolean;
  isBlocked: boolean;
}) {
  const domElementRef = useRef<HTMLElement | null>(null);
  useEffectOnlyOnce(() => {
    if (domElementRef.current) {
      renderedInputCatchers.set(viewportID, domElementRef.current);
    }
    return () => {
      renderedInputCatchers.delete(viewportID);
    };
  });

  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);

  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");

  const adaptedTool =
    viewportID === ArbitraryViews.arbitraryViewport
      ? AnnotationTool.SKELETON
      : viewportID === OrthoViews.TDView
        ? AnnotationTool.MOVE
        : adaptActiveToolToShortcuts(
            activeTool,
            isShiftPressed,
            isControlOrMetaPressed,
            isAltPressed,
          );

  return (
    <div
      id={`screenshot_target_inputcatcher_${viewportID}`}
      className={`inputcatcher-border ${viewportID}`}
    >
      <div
        className="flexlayout-dont-overflow"
        onContextMenu={ignoreContextMenu}
        style={{ cursor: isBlocked ? "wait" : cursorForTool[adaptedTool.id] }}
      >
        <div
          id={`inputcatcher_${viewportID}`}
          ref={(domElement) => {
            domElementRef.current = domElement;
          }}
          data-value={viewportID}
          className={`inputcatcher ${viewportID}`}
          style={{
            position: "relative",
            // Disable inputs while WK is busy. However, keep the custom cursor and the ignoreContextMenu handler
            // which is why those are defined at the outer element.
            // Note that due to race conditions a pointer event might still get through even
            // though an operation is in progress. Sagas should use takeEveryInOperationContext
            // or createOperationContext to guard against this.
            pointerEvents: isBlocked ? "none" : "auto",
          }}
        >
          <ViewportStatusIndicator />
          {displayScalebars && viewportID !== "arbitraryViewport" ? (
            <Scalebar viewportID={viewportID} />
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

export default InputCatcher;
