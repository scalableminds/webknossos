import { Button, Typography, theme } from "antd";
import { useWkSelector } from "libs/react_hooks";
import window from "libs/window";
import throttle from "lodash-es/throttle";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { EmptyObject } from "types/type_utils";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { NodeListItem } from "viewer/view/right_border_tabs/abstract_tree_renderer";
import AbstractTreeRenderer from "viewer/view/right_border_tabs/abstract_tree_renderer";

const AbstractTreeTab: React.FC<EmptyObject> = () => {
  const skeletonTracing = useWkSelector((state) => state.annotation.skeleton);
  const activeTreeId = useWkSelector((state) => state.localSkeletonState.activeTreeId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const nodeListRef = useRef<Array<NodeListItem>>([]);
  const dispatch = useDispatch();
  // The canvas cannot resolve CSS variables, so the resolved token values are passed instead.
  // Since they are part of drawTreeImpl's dependencies, a theme switch triggers a redraw.
  const { token } = theme.useToken();
  const foregroundColor = token.colorText;
  const commentColor = token.colorError;

  const drawTreeImpl = useCallback(() => {
    if (!skeletonTracing || !isVisible) {
      return;
    }

    const { activeNodeId, trees } = skeletonTracing;
    const canvas = canvasRef.current;

    if (canvas) {
      nodeListRef.current = AbstractTreeRenderer.drawTree(
        canvas,
        activeTreeId != null ? trees.getNullable(activeTreeId) : null,
        activeNodeId,
        { foreground: foregroundColor, comment: commentColor },
        [canvas.offsetWidth, canvas.offsetHeight],
      );
    }
  }, [skeletonTracing, isVisible, activeTreeId, foregroundColor, commentColor]);

  // The throttled function is created only once and delegates to the latest
  // drawTreeImpl via a ref. Otherwise, the throttling would not take effect
  // across renders (drawing may be slow for very large tracings).
  const drawTreeImplRef = useRef(drawTreeImpl);
  // Keep the ref in sync in an effect (not during render) to keep the render
  // phase pure. This effect is declared before the drawing effect below so the
  // ref is updated first when drawTreeImpl changes.
  useEffect(() => {
    drawTreeImplRef.current = drawTreeImpl;
  }, [drawTreeImpl]);
  const drawTree = useMemo(() => throttle(() => drawTreeImplRef.current(), 1000), []);

  useEffect(() => {
    window.addEventListener("resize", drawTree, false);

    return () => {
      window.removeEventListener("resize", drawTree, false);
      drawTree.cancel();
    };
  }, [drawTree]);

  useEffect(() => {
    drawTree();
  }, [drawTreeImpl, drawTree]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const id = AbstractTreeRenderer.getIdFromPos(
        event.nativeEvent.offsetX,
        event.nativeEvent.offsetY,
        nodeListRef.current,
      );

      if (id != null) {
        dispatch(setActiveNodeAction(id));
      }
    },
    [dispatch],
  );

  const onClickShow = () => setIsVisible(true);

  return (
    <div className="flex-center">
      {isVisible ? (
        <canvas id="abstract-tree-canvas" ref={canvasRef} onClick={handleClick} />
      ) : (
        <React.Fragment>
          <Button type="primary" onClick={onClickShow}>
            Show Abstract Tree
          </Button>
          <Typography.Text type="secondary" style={{ marginTop: 6 }}>
            This may be slow for very large tracings.
          </Typography.Text>
        </React.Fragment>
      )}
    </div>
  );
};

export default AbstractTreeTab;
