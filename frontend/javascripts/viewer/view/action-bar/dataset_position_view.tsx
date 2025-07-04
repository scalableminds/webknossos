import { PushpinOutlined, ReloadOutlined } from "@ant-design/icons";
import { Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import message from "messages";
import type React from "react";
import type { Vector3 } from "viewer/constants";
import constants from "viewer/constants";
import { getDatasetExtentInVoxel } from "viewer/model/accessors/dataset_accessor";
import { getPosition, getRotation } from "viewer/model/accessors/flycam_accessor";
import { setPositionAction, setRotationAction } from "viewer/model/actions/flycam_actions";
import Store from "viewer/store";
import { ShareButton } from "viewer/view/action-bar/share_modal_view";
import ButtonComponent from "viewer/view/components/button_component";

const positionIconStyle: React.CSSProperties = {
  transform: "rotate(-45deg)",
  marginRight: 0,
};
const warningColors: React.CSSProperties = {
  color: "rgb(255, 155, 85)",
  borderColor: "rgb(241, 122, 39)",
};
const iconErrorStyle: React.CSSProperties = { ...warningColors };
const positionInputDefaultStyle: React.CSSProperties = {
  textAlign: "center",
};
const positionInputErrorStyle: React.CSSProperties = {
  ...positionInputDefaultStyle,
  ...warningColors,
};

function DatasetPositionView() {
  const flycam = useWkSelector((state) => state.flycam);
  const viewMode = useWkSelector((state) => state.temporaryConfiguration.viewMode);
  const dataset = useWkSelector((state) => state.dataset);
  const task = useWkSelector((state) => state.task);

  const copyPositionToClipboard = async () => {
    const position = V3.floor(getPosition(flycam)).join(", ");
    await navigator.clipboard.writeText(position);
    Toast.success("Position copied to clipboard");
  };

  const copyRotationToClipboard = async () => {
    const rotation = V3.round(getRotation(flycam)).join(", ");
    await navigator.clipboard.writeText(rotation);
    Toast.success("Rotation copied to clipboard");
  };

  const handleChangePosition = (position: Vector3) => {
    Store.dispatch(setPositionAction(position));
  };

  const handleChangeRotation = (rotation: Vector3) => {
    Store.dispatch(setRotationAction(rotation));
  };

  const isPositionOutOfBounds = (position: Vector3) => {
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
      const bboxMax = [
        bbox.topLeft[0] + bbox.width,
        bbox.topLeft[1] + bbox.height,
        bbox.topLeft[2] + bbox.depth,
      ];
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number[]' is not assignable to p... Remove this comment to see the full error message
      isOutOfTaskBounds = isPositionOutOfBounds(bbox.topLeft, bboxMax);
    }

    return {
      isOutOfDatasetBounds,
      isOutOfTaskBounds,
    };
  };

  const position = V3.floor(getPosition(flycam));
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

  const rotation = V3.round(getRotation(flycam));
  const isArbitraryMode = constants.MODES_ARBITRARY.includes(viewMode);
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
        <ShareButton dataset={dataset} style={iconColoringStyle} />
      </Space.Compact>
      {isArbitraryMode ? (
        <Space.Compact
          style={{
            whiteSpace: "nowrap",
            marginLeft: 10,
          }}
        >
          <FastTooltip title={message["tracing.copy_rotation"]} placement="bottom-start">
            <ButtonComponent
              onClick={copyRotationToClipboard}
              style={{
                padding: "0 10px",
              }}
              className="hide-on-small-screen"
            >
              <ReloadOutlined />
            </ButtonComponent>
          </FastTooltip>
          <Vector3Input
            value={rotation}
            onChange={handleChangeRotation}
            style={{
              textAlign: "center",
              width: 120,
            }}
            allowDecimals
          />
        </Space.Compact>
      ) : null}
    </div>
  );

  return (
    <FastTooltip title={maybeErrorMessage || null} wrapper="div">
      {positionView}
    </FastTooltip>
  );
}

export default DatasetPositionView;
