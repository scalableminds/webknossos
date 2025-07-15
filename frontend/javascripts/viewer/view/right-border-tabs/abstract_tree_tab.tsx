import { Button } from "antd";
import { useWkSelector } from "libs/react_hooks";
import window from "libs/window";
import _ from "lodash";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { EmptyObject } from "types/globals";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { NodeListItem } from "viewer/view/right-border-tabs/abstract_tree_renderer";
import AbstractTreeRenderer from "viewer/view/right-border-tabs/abstract_tree_renderer";

const AbstractTreeTab: React.FC<EmptyObject> = () => {
  const skeletonTracing = useWkSelector((state) => state.annotation.skeleton);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const nodeListRef = useRef<Array<NodeListItem>>([]);
  const dispatch = useDispatch();

  const drawTree = _.throttle(
    useCallback(() => {
      if (!skeletonTracing || !isVisible) {
        return;
      }

      const { activeTreeId, activeNodeId, trees } = skeletonTracing;
      const canvas = canvasRef.current;

      if (canvas) {
        nodeListRef.current = AbstractTreeRenderer.drawTree(
          canvas,
          activeTreeId != null ? trees.getNullable(activeTreeId) : null,
          activeNodeId,
          [canvas.offsetWidth, canvas.offsetHeight],
        );
      }
    }, [skeletonTracing, isVisible]),
    1000,
  );

  useEffect(() => {
    window.addEventListener("resize", drawTree, false);
    drawTree();

    return () => {
      window.removeEventListener("resize", drawTree, false);
    };
  }, [drawTree]);

  useEffect(() => {
    drawTree();
  }, [drawTree]);

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
          <span
            style={{
              color: "gray",
              marginTop: 6,
            }}
          >
            This may be slow for very large tracings.
          </span>
        </React.Fragment>
      )}
    </div>
  );
};

export default AbstractTreeTab;
