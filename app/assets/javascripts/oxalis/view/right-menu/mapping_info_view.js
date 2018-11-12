/**
 * mapping_info_view.js
 * @flow
 */
import { Table, Tooltip, Icon } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";

import { type OrthoView, OrthoViews, type Vector2, type Vector3 } from "oxalis/constants";
import type { OxalisState, Mapping } from "oxalis/store";
import { SwitchSetting } from "oxalis/view/settings/setting_input_views";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import Model from "oxalis/model";
import message from "messages";

type Props = {
  position: Vector3,
  zoomStep: number,
  mousePosition: ?Vector2,
  isMappingEnabled: boolean,
  mapping: ?Mapping,
  mappingColors: ?Array<number>,
  setMappingEnabled: boolean => void,
  activeViewport: OrthoView,
  activeCellId: number,
};

// This function mirrors convertCellIdToRGB in the fragment shader of the rendering plane
const convertCellIdToHSV = (id: number, customColors: ?Array<number>) => {
  if (id === 0) return "white";

  const goldenRatio = 0.618033988749895;
  const lastEightBits = id & (2 ** 8 - 1);
  const computedColor = (lastEightBits * goldenRatio) % 1.0;
  const value = customColors != null ? customColors[lastEightBits] || 0 : computedColor;

  return `hsla(${value * 360}, 100%, 50%, 0.15)`;
};

const hasSegmentation = () => Model.getSegmentationLayer() != null;

class MappingInfoView extends React.Component<Props> {
  componentDidMount() {
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
  }

  componentWillUnmount() {
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  _forceUpdate = _.throttle(() => {
    this.forceUpdate();
  }, 100);

  getSegmentationCube(): Cube {
    const layer = Model.getSegmentationLayer();
    if (!layer) {
      throw new Error("No segmentation layer found");
    }
    return layer.cube;
  }

  renderIdTable() {
    const cube = this.getSegmentationCube();
    const hasMapping = this.props.mapping != null;
    const customColors = this.props.isMappingEnabled ? this.props.mappingColors : null;

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
        mapped: idInfo.unmapped != null ? cube.mapId(idInfo.unmapped) : undefined,
      }))
      .map(idInfo => ({
        ...idInfo,
        unmapped: (
          <span style={{ background: convertCellIdToHSV(idInfo.unmapped) }}>{idInfo.unmapped}</span>
        ),
        mapped: (
          <span style={{ background: convertCellIdToHSV(idInfo.mapped, customColors) }}>
            {idInfo.mapped}
          </span>
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
    if (!hasSegmentation()) {
      return "No segmentation available";
    }
    const hasMapping = this.props.mapping != null;

    return (
      <div id="volume-mapping-info" className="info-tab-content">
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
    mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
    mousePosition: state.temporaryConfiguration.mousePosition,
    activeViewport: state.viewModeData.plane.activeViewport,
    activeCellId: getVolumeTracing(state.tracing)
      .map(tracing => tracing.activeCellId)
      .getOrElse(0),
  };
}

const debounceTime = 100;
export default connect(
  mapStateToProps,
  mapDispatchToProps,
  null,
  {
    pure: false,
  },
)(debounceRender(MappingInfoView, debounceTime));
