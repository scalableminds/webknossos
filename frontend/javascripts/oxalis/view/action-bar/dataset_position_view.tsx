import { PushpinOutlined, ReloadOutlined } from "@ant-design/icons";
import { Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import message from "messages";
import type { Vector3, ViewMode } from "oxalis/constants";
import constants from "oxalis/constants";
import { getDatasetExtentInVoxel } from "oxalis/model/accessors/dataset_accessor";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import type { Flycam, OxalisState, Task } from "oxalis/store";
import Store from "oxalis/store";
import { ShareButton } from "oxalis/view/action-bar/share_modal_view";
import ButtonComponent from "oxalis/view/components/button_component";
import type React from "react";
import { PureComponent } from "react";
import { connect } from "react-redux";
import type { APIDataset } from "types/api_flow_types";

type Props = {
  flycam: Flycam;
  viewMode: ViewMode;
  dataset: APIDataset;
  task: Task | null | undefined;
};
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

  render() {
    const position = V3.floor(getPosition(this.props.flycam));
    const { isOutOfDatasetBounds, isOutOfTaskBounds } = this.isPositionOutOfBounds(position);
    const iconColoringStyle = isOutOfDatasetBounds || isOutOfTaskBounds ? iconErrorStyle : {};
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
              onClick={this.copyPositionToClipboard}
              style={{ padding: "0 10px", ...iconColoringStyle }}
              className="hide-on-small-screen"
            >
              <PushpinOutlined style={positionIconStyle} />
            </ButtonComponent>
          </FastTooltip>
          <Vector3Input
            value={position}
            onChange={this.handleChangePosition}
            autoSize
            style={positionInputStyle}
            allowDecimals
          />
          <ShareButton dataset={this.props.dataset} style={iconColoringStyle} />
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
                onClick={this.copyRotationToClipboard}
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
              onChange={this.handleChangeRotation}
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
}

function mapStateToProps(state: OxalisState): Props {
  return {
    flycam: state.flycam,
    viewMode: state.temporaryConfiguration.viewMode,
    dataset: state.dataset,
    task: state.task,
  };
}

const connector = connect(mapStateToProps);
export default connector(DatasetPositionView);
