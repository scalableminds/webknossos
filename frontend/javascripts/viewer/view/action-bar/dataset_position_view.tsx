import { PushpinOutlined } from "@ant-design/icons";
import { Col, Row, Space, Tooltip } from "antd";
import FastTooltip from "components/fast_tooltip";
import { formatNumberToLength } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import message from "messages";
import type React from "react";
import { useState } from "react";
import type { VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import { getDatasetExtentInVoxel } from "viewer/model/accessors/dataset_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { convertVoxelSizeToUnit } from "viewer/model/scaleinfo";
import Store from "viewer/store";
import { ShareButton } from "viewer/view/action-bar/share_modal_view";
import ButtonComponent from "viewer/view/components/button_component";
import DatasetRotationPopoverButtonView from "./dataset_rotation_popover_view";

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

const getPositionTooltipContent = (position: Vector3, voxelSize: VoxelSize) => {
  const voxelSizeInMetricUnit = convertVoxelSizeToUnit(
    voxelSize,
    LongUnitToShortUnitMap[voxelSize.unit],
  );
  const positionInMetrics = position.map((coord, index) => coord * voxelSizeInMetricUnit[index]);
  const positionInMetricString = positionInMetrics.map((coord) =>
    formatNumberToLength(coord, LongUnitToShortUnitMap[voxelSize.unit]),
  );
  console.log("positionInMetricString", positionInMetricString);
  return (
    <div>
      <Row justify="space-between" gutter={4}>
        <Col>{position[0]}vx,</Col>
        <Col>{position[1]}vx,</Col>
        <Col>{position[2]}vx</Col>
      </Row>
      <Row justify="space-between" gutter={4}>
        <Col>{positionInMetricString[0]},</Col>
        <Col>{positionInMetricString[1]},</Col>
        <Col>{positionInMetricString[2]}</Col>
      </Row>
    </div>
  );
};

function DatasetPositionView() {
  const flycam = useWkSelector((state) => state.flycam);
  const dataset = useWkSelector((state) => state.dataset);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const task = useWkSelector((state) => state.task);

  const copyPositionToClipboard = async () => {
    const position = V3.floor(getPosition(flycam)).join(", ");
    await navigator.clipboard.writeText(position);
    Toast.success("Position copied to clipboard");
  };

  const handleChangePosition = (position: Vector3) => {
    Store.dispatch(setPositionAction(position));
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
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  return (
    <FastTooltip title={maybeErrorMessage || null} wrapper="div">
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
        <Tooltip
          title={isTooltipOpen ? getPositionTooltipContent(position, voxelSize) : null}
          open={isTooltipOpen}
        >
          <Vector3Input
            value={position}
            onChange={handleChangePosition}
            autoSize
            style={positionInputStyle}
            allowDecimals
            onMouseEnter={() => setIsTooltipOpen(true)}
            onMouseLeave={() => setIsTooltipOpen(false)}
          />
        </Tooltip>
        <DatasetRotationPopoverButtonView style={iconColoringStyle} />
        <ShareButton dataset={dataset} style={iconColoringStyle} />
      </Space.Compact>
    </FastTooltip>
  );
}

export default DatasetPositionView;
