import { PushpinOutlined } from "@ant-design/icons";
import { Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import message from "messages";
import type React from "react";
import { useCallback, useMemo } from "react";
import type { EmptyObject } from "types/globals";
import type { Vector3 } from "viewer/constants";
import { getDatasetExtentInVoxel } from "viewer/model/accessors/dataset_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import Store from "viewer/store";
import { ShareButton } from "viewer/view/action-bar/share_modal_view";
import ButtonComponent from "viewer/view/components/button_component";
import DatasetRotationPopoverButtonView, { warningColors } from "./dataset_rotation_popover_view";

const positionIconStyle: React.CSSProperties = {
  transform: "rotate(-45deg)",
  marginRight: 0,
};
const iconErrorStyle: React.CSSProperties = { ...warningColors };
const positionInputDefaultStyle: React.CSSProperties = {
  textAlign: "center",
};
const positionInputErrorStyle: React.CSSProperties = {
  ...positionInputDefaultStyle,
  ...warningColors,
};

const DatasetPositionAndRotationView: React.FC<EmptyObject> = () => {
  const flycam = useWkSelector((state) => state.flycam);
  const dataset = useWkSelector((state) => state.dataset);
  const task = useWkSelector((state) => state.task);

  const position = useMemo(() => V3.floor(getPosition(flycam)), [flycam]);

  const isPositionOutOfBounds = useCallback(
    (position: Vector3) => {
      const { min: datasetMin, max: datasetMax } = getDatasetExtentInVoxel(dataset);

      const isPositionOutOfBounds = (min: Vector3, max: Vector3) =>
        position[0] < min[0] ||
        position[1] < min[1] ||
        position[2] < min[2] ||
        position[0] >= max[0] ||
        position[1] >= max[1] ||
        position[2] >= max[2];

      const isOutOfDatasetBounds = isPositionOutOfBounds(datasetMin, datasetMax);
      let isOutOfTaskBounds = false;

      if (task?.boundingBox) {
        const bbox = task.boundingBox;
        const bboxMax: Vector3 = [
          bbox.topLeft[0] + bbox.width,
          bbox.topLeft[1] + bbox.height,
          bbox.topLeft[2] + bbox.depth,
        ];
        isOutOfTaskBounds = isPositionOutOfBounds(bbox.topLeft, bboxMax);
      }

      return {
        isOutOfDatasetBounds,
        isOutOfTaskBounds,
      };
    },
    [dataset, task],
  );

  const { isOutOfDatasetBounds, isOutOfTaskBounds } = isPositionOutOfBounds(position);
  const iconColoringStyle = isOutOfDatasetBounds || isOutOfTaskBounds ? iconErrorStyle : {};
  const positionInputStyle =
    isOutOfDatasetBounds || isOutOfTaskBounds ? positionInputErrorStyle : positionInputDefaultStyle;

  let maybeErrorMessage = null;
  if (isOutOfDatasetBounds) {
    maybeErrorMessage = message["tracing.out_of_dataset_bounds"];
  } else if (!maybeErrorMessage && isOutOfTaskBounds) {
    maybeErrorMessage = message["tracing.out_of_task_bounds"];
  }

  const copyPositionToClipboard = useCallback(async () => {
    const posStr = V3.floor(getPosition(flycam)).join(", ");
    await navigator.clipboard.writeText(posStr);
    Toast.success("Position copied to clipboard");
  }, [flycam]);

  const handleChangePosition = useCallback((position: Vector3) => {
    Store.dispatch(setPositionAction(position));
  }, []);

  const positionView = (
    <div
      style={{
        display: "flex",
      }}
    >
      <Space.Compact
        style={{
          whiteSpace: "nowrap",
        }}
      >
        <FastTooltip title={message["tracing.copy_position"]} placement="bottom-start">
          <ButtonComponent
            onClick={copyPositionToClipboard}
            style={{ padding: "0 10px", ...iconColoringStyle }}
            className="hide-on-small-screen"
          >
            <PushpinOutlined style={positionIconStyle} />
          </ButtonComponent>
        </FastTooltip>
        <Vector3Input
          value={position}
          onChange={handleChangePosition}
          autoSize
          style={positionInputStyle}
          allowDecimals
        />
        <DatasetRotationPopoverButtonView style={iconColoringStyle} />
        <ShareButton dataset={dataset} style={iconColoringStyle} />
      </Space.Compact>
    </div>
  );

  return (
    <FastTooltip title={maybeErrorMessage || null} wrapper="div">
      {positionView}
    </FastTooltip>
  );
};

export default DatasetPositionAndRotationView;
