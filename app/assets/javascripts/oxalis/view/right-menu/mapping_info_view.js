/**
 * mapping_info_view.js
 * @flow
 */
import React, { Component } from "react";
import { Table, Tooltip, Icon } from "antd";
import { connect } from "react-redux";
import Cube from "oxalis/model/binary/data_cube";
import Model from "oxalis/model";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { SwitchSetting } from "oxalis/view/settings/setting_input_views";
import type { OrthoViewType, Vector2, Vector3 } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import { OrthoViews } from "oxalis/constants";
import _ from "lodash";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import message from "messages";

type Props = {
  position: Vector3,
  mousePosition: ?Vector2,
  isMappingEnabled: boolean,
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
    const cube = this.getCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
    cube.on("newMapping", this._forceUpdate);
  }

  componentWillUnmount() {
    const cube = this.getCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
    cube.off("newMapping", this._forceUpdate);
  }

  _forceUpdate = _.throttle(() => {
    this.forceUpdate();
  }, 100);

  getCube(): Cube {
    return Model.getSegmentationBinary().cube;
  }

  handleChangeMappingEnabled = (isEnabled: boolean) => {
    this.getCube().setMappingEnabled(isEnabled);
  };

  renderIdTable() {
    const cube = this.getCube();
    const hasMapping = cube.hasMapping();

    let globalMousePosition;
    if (this.props.mousePosition && this.props.activeViewport !== OrthoViews.TDView) {
      const [x, y] = this.props.mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    const getIdForPos = pos => pos && cube.getDataValue(pos, null);

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
        mapped: idInfo.unmapped && cube.mapID(idInfo.unmapped, cube.mapping),
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
    const idColumns = hasMapping
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
    const cube = this.getCube();
    const hasMapping = cube.hasMapping();

    return (
      <div id="volume-mapping-info">
        {hasMapping ? (
          <div style={{ marginBottom: 12 }}>
            <SwitchSetting
              value={this.props.isMappingEnabled}
              onChange={this.handleChangeMappingEnabled}
              label="Enable Mapping"
            />
          </div>
        ) : null}
        {this.renderIdTable()}
      </div>
    );
  }
}

function mapStateToProps(state: OxalisState): Props {
  return {
    position: getPosition(state.flycam),
    isMappingEnabled: state.temporaryConfiguration.isMappingEnabled,
    mousePosition: state.temporaryConfiguration.mousePosition,
    activeViewport: state.viewModeData.plane.activeViewport,
    activeCellId: typeof state.tracing.activeCellId === "number" ? state.tracing.activeCellId : 0,
  };
}

export default connect(mapStateToProps)(MappingInfoView);
