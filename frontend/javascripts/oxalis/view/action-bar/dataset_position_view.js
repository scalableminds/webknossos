// @flow
import { Input, Tooltip } from "antd";
import { PushpinOutlined, ReloadOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import type { APIDataset } from "types/api_flow_types";
import { V3 } from "libs/mjs";
import { Vector3Input } from "libs/vector_input";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getDatasetExtentInVoxel } from "oxalis/model/accessors/dataset_accessor";
import ButtonComponent from "oxalis/view/components/button_component";
import Store, { type OxalisState, type Flycam, type Task } from "oxalis/store";
import Toast from "libs/toast";
import constants, { type ViewMode, type Vector3 } from "oxalis/constants";
import message from "messages";

type Props = {|
  flycam: Flycam,
  viewMode: ViewMode,
  dataset: APIDataset,
  task: ?Task,
|};

const positionIconStyle = { transform: "rotate(-45deg)" };
const warningColors = { color: "rgb(255, 155, 85)", borderColor: "rgb(241, 122, 39)" };
const copyPositionDefaultStyle = { padding: "0 10px" };
const copyPositionErrorStyle = {
  ...copyPositionDefaultStyle,
  ...warningColors,
};
const positionInputDefaultStyle = { textAlign: "center" };
const positionInputErrorStyle = {
  ...positionInputDefaultStyle,
  ...warningColors,
};

class DatasetPositionView extends PureComponent<Props> {
  copyPositionToClipboard = async () => {
    const position = V3.floor(getPosition(this.props.flycam)).join(", ");
    await navigator.clipboard.writeText(position);
    Toast.success("Position copied to clipboard");
  };

  copyRotationToClipboard = async () => {
    const rotation = V3.round(getRotation(this.props.flycam)).join(", ");
    await navigator.clipboard.writeText(rotation);
    Toast.success("Rotation copied to clipboard");
  };

  handleChangePosition = (position: Vector3) => {
    Store.dispatch(setPositionAction(position));
  };

  handleChangeRotation = (rotation: Vector3) => {
    Store.dispatch(setRotationAction(rotation));
  };

  isPositionOutOfBounds = (position: Vector3) => {
    const { dataset, task } = this.props;
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
    if (task && task.boundingBox) {
      const bbox = task.boundingBox;
      const bboxMax = [
        bbox.topLeft[0] + bbox.width,
        bbox.topLeft[1] + bbox.height,
        bbox.topLeft[2] + bbox.depth,
      ];
      isOutOfTaskBounds = isPositionOutOfBounds(bbox.topLeft, bboxMax);
    }
    return { isOutOfDatasetBounds, isOutOfTaskBounds };
  };

  render() {
    const position = V3.floor(getPosition(this.props.flycam));
    const { isOutOfDatasetBounds, isOutOfTaskBounds } = this.isPositionOutOfBounds(position);
    const copyPositionStyle =
      isOutOfDatasetBounds || isOutOfTaskBounds ? copyPositionErrorStyle : copyPositionDefaultStyle;
    const positionInputStyle =
      isOutOfDatasetBounds || isOutOfTaskBounds
        ? positionInputErrorStyle
        : positionInputDefaultStyle;

    let maybeErrorMessage = null;
    if (isOutOfDatasetBounds) {
      maybeErrorMessage = message["tracing.out_of_dataset_bounds"];
    } else if (!maybeErrorMessage && isOutOfTaskBounds) {
      maybeErrorMessage = message["tracing.out_of_task_bounds"];
    }
    const rotation = V3.round(getRotation(this.props.flycam));
    const isArbitraryMode = constants.MODES_ARBITRARY.includes(this.props.viewMode);

    const positionView = (
      <div style={{ display: "flex" }}>
        <Input.Group compact style={{ whiteSpace: "nowrap" }}>
          <Tooltip title={message["tracing.copy_position"]} placement="bottomLeft">
            <ButtonComponent
              onClick={this.copyPositionToClipboard}
              style={copyPositionStyle}
              className="hide-on-small-screen"
            >
              <PushpinOutlined style={positionIconStyle} />
            </ButtonComponent>
          </Tooltip>
          <Vector3Input
            value={position}
            onChange={this.handleChangePosition}
            autoSize
            style={positionInputStyle}
            allowDecimals
          />
        </Input.Group>
        {isArbitraryMode ? (
          <Input.Group compact style={{ whiteSpace: "nowrap", marginLeft: 10 }}>
            <Tooltip title={message["tracing.copy_rotation"]} placement="bottomLeft">
              <ButtonComponent
                onClick={this.copyRotationToClipboard}
                style={{ padding: "0 10px" }}
                className="hide-on-small-screen"
              >
                <ReloadOutlined />
              </ButtonComponent>
            </Tooltip>
            <Vector3Input
              value={rotation}
              onChange={this.handleChangeRotation}
              style={{ textAlign: "center", width: 120 }}
              allowDecimals
            />
          </Input.Group>
        ) : null}
      </div>
    );
    return <Tooltip title={maybeErrorMessage || null}>{positionView}</Tooltip>;
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    flycam: state.flycam,
    viewMode: state.temporaryConfiguration.viewMode,
    dataset: state.dataset,
    task: state.task,
  };
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(DatasetPositionView);
