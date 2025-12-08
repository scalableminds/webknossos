import { CopyOutlined, PushpinOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import { Col, Popover, Row, Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { formatNumberToLength, formatVoxelsForHighNumbers } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import message from "messages";
import type React from "react";
import { useState } from "react";
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
  const [getPositionStrings, setGetPositionStrings] = useState(false);

  const getPositionTooltipContent = () => {
    const shortUnit = LongUnitToShortUnitMap[voxelSize.unit];
    const positionInVxStrings = position.map((coord) => formatVoxelsForHighNumbers(coord));
    const voxelSizeInMetricUnit = convertVoxelSizeToUnit(voxelSize, shortUnit);
    const positionInMetrics = position.map((coord, index) => coord * voxelSizeInMetricUnit[index]);
    const positionInMetricStrings = positionInMetrics.map((coord) =>
      formatNumberToLength(coord, shortUnit),
    );
    return (
      <div>
        <Row justify="space-between" gutter={16} wrap={false}>
          <Col span={7}>{positionInVxStrings[0]},</Col>
          <Col span={7}>{positionInVxStrings[1]},</Col>
          <Col span={7}>{positionInVxStrings[2]}</Col>
          <Col span={3}>
            <CopyOutlined
              onClick={() => {
                copyToClipboad(positionInVxStrings.join(", "));
              }}
            />
          </Col>
        </Row>
        <Row justify="space-between" gutter={16} wrap={false}>
          <Col span={7}>{positionInMetricStrings[0]},</Col>
          <Col span={7}>{positionInMetricStrings[1]},</Col>
          <Col span={7}>{positionInMetricStrings[2]}</Col>
          <Col span={3}>
            <CopyOutlined
              onClick={() => {
                copyToClipboad(positionInMetricStrings.join(", "));
              }}
            />
          </Col>
        </Row>
      </div>
    );
  };

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
        <Popover
          content={getPositionStrings ? getPositionTooltipContent() : <></>} // popover needs some content to open, even if empty
          style={{ minWidth: 300 }}
          onOpenChange={setGetPositionStrings}
        >
          <Vector3Input
            value={position}
            onChange={handleChangePosition}
            autoSize
            style={positionInputStyle}
            allowDecimals
          />
        </Popover>
        <DatasetRotationPopoverButtonView style={iconColoringStyle} />
        <ShareButton dataset={dataset} style={iconColoringStyle} />
      </Space.Compact>
    </FastTooltip>
  );
}

export default DatasetPositionView;
