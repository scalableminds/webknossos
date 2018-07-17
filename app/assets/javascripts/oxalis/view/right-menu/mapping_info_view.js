/**
 * mapping_info_view.js
 * @flow
 */
import React, { Component } from "react";
import { Table, Tooltip, Icon } from "antd";
import { connect } from "react-redux";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { SwitchSetting } from "oxalis/view/settings/setting_input_views";
import type { OrthoViewType, Vector2, Vector3 } from "oxalis/constants";
import type { OxalisState, MappingType } from "oxalis/store";
import { OrthoViews } from "oxalis/constants";
import _ from "lodash";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import message from "messages";
import debounceRender from "react-debounce-render";

type Props = {
  position: Vector3,
  zoomStep: number,
  mousePosition: ?Vector2,
  isMappingEnabled: boolean,
  mapping: ?MappingType,
  setMappingEnabled: boolean => void,
  activeViewport: OrthoViewType,
  activeCellId: number,
};

// This function mirrors convertCellIdToRGB in the fragment shader of the rendering plane
const convertCellIdToHSV = id => {
  if (id === 0) {
    return "white";
  }
  const goldenRatio = 0.618033988749895;
  const lastEightBits = id & (2 ** 8 - 1);
  const value = ((lastEightBits * goldenRatio) % 1.0) * 360;

  return `hsla(${value}, 100%, 50%, 0.15)`;
};

class MappingInfoView extends Component<Props> {
  componentDidMount() {
    const cube = this.getSegmentationCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
  }

  componentWillUnmount() {
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  _forceUpdate = _.throttle(() => {
    this.forceUpdate();
  }, 100);

  getSegmentationCube(): Cube {
    return Model.getSegmentationLayer().cube;
  }

  renderIdTable() {
    const cube = this.getSegmentationCube();
    const hasMapping = this.props.mapping != null;

    let globalMousePosition;
    if (this.props.mousePosition && this.props.activeViewport !== OrthoViews.TDView) {
      const [x, y] = this.props.mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    const getIdForPos = pos => pos && cube.getDataValue(pos, null, this.props.zoomStep);

    const tableData = [
      { name: "Active ID", key: "active", unmapped: this.props.activeCellId },
      {
        name: "ID at current position",
        key: "current",
        unmapped: getIdForPos(this.props.position),
      },
      {
        name: (
          <span>
            ID at mouse position{" "}
            <Tooltip
              title={
                message[hasMapping ? "tracing.copy_maybe_mapped_cell_id" : "tracing.copy_cell_id"]
              }
              placement="bottomLeft"
            >
              <Icon type="info-circle" />
            </Tooltip>
          </span>
        ),
        key: "mouse",
        unmapped: getIdForPos(globalMousePosition),
      },
    ]
      .map(idInfo => ({
        ...idInfo,
        mapped: idInfo.unmapped && cube.mapId(idInfo.unmapped),
      }))
      .map(idInfo => ({
        ...idInfo,
        unmapped: (
          <span style={{ background: convertCellIdToHSV(idInfo.unmapped) }}>{idInfo.unmapped}</span>
        ),
        mapped: (
          <span style={{ background: convertCellIdToHSV(idInfo.mapped) }}>{idInfo.mapped}</span>
        ),
      }));

    const columnHelper = (title, dataIndex) => ({ title, dataIndex });
    const idColumns =
      hasMapping && this.props.isMappingEnabled
        ? // Show an unmapped and mapped id column if there's a mapping
          [columnHelper("Unmapped", "unmapped"), columnHelper("Mapped", "mapped")]
        : // Otherwise, only show an ID column
          [columnHelper("ID", "unmapped")];
    const columns = [columnHelper("", "name"), ...idColumns];
    return (
      <Table
        style={{ maxWidth: 500 }}
        size="small"
        dataSource={tableData}
        columns={columns}
        pagination={false}
        align="right"
      />
    );
  }

  render() {
    const hasMapping = this.props.mapping != null;

    return (
      <div id="volume-mapping-info">
        {hasMapping ? (
          <div style={{ marginBottom: 12 }}>
            <SwitchSetting
              value={this.props.isMappingEnabled}
              onChange={this.props.setMappingEnabled}
              label="Enable Mapping"
            />
          </div>
        ) : null}
        {this.renderIdTable()}
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setMappingEnabled(isEnabled) {
    dispatch(setMappingEnabledAction(isEnabled));
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    position: getPosition(state.flycam),
    zoomStep: getRequestLogZoomStep(state),
    isMappingEnabled: state.temporaryConfiguration.activeMapping.isMappingEnabled,
    mapping: state.temporaryConfiguration.activeMapping.mapping,
    mousePosition: state.temporaryConfiguration.mousePosition,
    activeViewport: state.viewModeData.plane.activeViewport,
    activeCellId: state.tracing.type === "volume" ? state.tracing.activeCellId : 0,
  };
}

const debounceTime = 100;
export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(debounceRender(MappingInfoView, debounceTime));
