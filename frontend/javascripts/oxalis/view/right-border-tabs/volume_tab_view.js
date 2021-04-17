// @flow

import features from "features";
import { Table, Tooltip, Modal } from "antd";
import type { Dispatch } from "redux";
import { InfoCircleOutlined, WarningOutlined, StopOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";

import type { APIDataset, APISegmentationLayer } from "types/api_flow_types";
import { unlinkFallbackSegmentation } from "admin/admin_rest_api";
import {
  type OrthoView,
  OrthoViews,
  type Vector2,
  type Vector3,
  type ControlMode,
  ControlModeEnum,
} from "oxalis/constants";
import {
  enforceVolumeTracing,
  getVolumeTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import type { OxalisState, Mapping, Tracing } from "oxalis/store";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";

import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentationLayer,
  getResolutionInfoOfSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";

import {
  LogSliderSetting,
  NumberInputSetting,
  SwitchSetting,
} from "oxalis/view/components/setting_input_views";

import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import Cube from "oxalis/model/bucket_data_handling/data_cube";

import Model from "oxalis/model";
import messages, { settings as settingsLabels } from "messages";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import DataLayer from "oxalis/model/data_layer";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";

type StateProps = {|
  dataset: APIDataset,
  segmentationLayer: ?APISegmentationLayer,
  position: Vector3,
  mousePosition: ?Vector2,
  isMappingEnabled: boolean,
  mapping: ?Mapping,
  mappingColors: ?Array<number>,
  activeViewport: OrthoView,
  activeCellId: number,
  brushSize: number,
  tracing: Tracing,
  onChangeBrushSize: (value: any) => void,
  onChangeActiveCellId: (value: number) => void,
  onChangeEnableAutoBrush: (active: boolean) => void,
  onUnlinkFallbackLayer: Tracing => Promise<void>,
  isAutoBrushEnabled: boolean,
  controlMode: ControlMode,
  dataset: APIDataset,
|};
type Props = {| ...StateProps |};

const convertHSLAToCSSString = ([h, s, l, a]) => `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
export const convertCellIdToCSS = (id: number, customColors: ?Array<number>, alpha?: number) =>
  convertHSLAToCSSString(jsConvertCellIdToHSLA(id, customColors, alpha));

const hasSegmentation = () => Model.getSegmentationLayer() != null;

class VolumeTabView extends React.Component<Props> {
  isMounted: boolean = false;

  componentDidMount() {
    this.isMounted = true;
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
  }

  componentWillUnmount() {
    this.isMounted = false;
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  // eslint-disable-next-line react/sort-comp
  _forceUpdate = _.throttle(() => {
    if (!this.isMounted) {
      return;
    }
    this.forceUpdate();
  }, 100);

  getSegmentationLayer(): DataLayer {
    const layer = Model.getSegmentationLayer();
    if (!layer) {
      throw new Error("No segmentation layer found");
    }
    return layer;
  }

  getSegmentationCube(): Cube {
    const segmentationLayer = this.getSegmentationLayer();
    return segmentationLayer.cube;
  }

  renderIdTable() {
    const {
      mapping,
      isMappingEnabled,
      mappingColors,
      activeViewport,
      mousePosition,
      position,
      dataset,
      segmentationLayer,
    } = this.props;
    const cube = this.getSegmentationCube();
    const hasMapping = mapping != null;
    const customColors = isMappingEnabled ? mappingColors : null;

    let globalMousePosition;
    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    const flycamPosition = position;
    const segmentationLayerName = this.getSegmentationLayer().name;

    const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      flycamPosition,
    );
    const renderedZoomStepForMousePosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      globalMousePosition,
    );

    const getResolutionOfZoomStepAsString = usedZoomStep => {
      const usedResolution = getResolutionInfoOfSegmentationLayer(dataset).getResolutionByIndex(
        usedZoomStep,
      );
      return usedResolution
        ? `${usedResolution[0]}-${usedResolution[1]}-${usedResolution[2]}`
        : "Not available";
    };
    const getIdForPos = (pos, usableZoomStep) =>
      pos && cube.getDataValue(pos, null, usableZoomStep);

    const tableData = [
      {
        name: "Active ID",
        key: "active",
        unmapped: this.props.activeCellId,
        resolution: "",
      },
      {
        name: "ID at the center",
        key: "current",
        unmapped: getIdForPos(flycamPosition, renderedZoomStepForCameraPosition),
        resolution: getResolutionOfZoomStepAsString(renderedZoomStepForCameraPosition),
      },
      {
        name: (
          <span>
            ID at mouse position{" "}
            <Tooltip
              title={
                messages[hasMapping ? "tracing.copy_maybe_mapped_cell_id" : "tracing.copy_cell_id"]
              }
              placement="bottomLeft"
            >
              <InfoCircleOutlined />
            </Tooltip>
          </span>
        ),
        key: "mouse",
        unmapped: getIdForPos(globalMousePosition, renderedZoomStepForMousePosition),
        resolution: globalMousePosition
          ? getResolutionOfZoomStepAsString(renderedZoomStepForMousePosition)
          : "Not available",
      },
    ]
      .map(idInfo => ({
        ...idInfo,
        mapped: idInfo.unmapped != null ? cube.mapId(idInfo.unmapped) : undefined,
      }))
      .map(idInfo => ({
        ...idInfo,
        unmapped: (
          <span
            style={{
              background: convertCellIdToCSS(idInfo.unmapped || 0, null, 0.15),
            }}
          >
            {idInfo.unmapped}
          </span>
        ),
        mapped: (
          <span
            style={{
              background: convertCellIdToCSS(idInfo.mapped || 0, customColors, 0.15),
            }}
          >
            {idInfo.mapped}
          </span>
        ),
      }));

    const columnHelper = (title, dataIndex) => ({
      title,
      dataIndex,
    });
    const showSegmentation64bitWarning =
      segmentationLayer && segmentationLayer.originalElementClass === "uint64";
    const maybeWithTooltipWarningTitle = title =>
      showSegmentation64bitWarning ? (
        <React.Fragment>
          {title}{" "}
          <Tooltip title={messages["tracing.uint64_segmentation_warning"]}>
            <WarningOutlined style={{ color: "rgb(255, 155, 85)" }} />
          </Tooltip>
        </React.Fragment>
      ) : (
        title
      );
    const idColumns =
      hasMapping && this.props.isMappingEnabled
        ? // Show an unmapped and mapped id column if there's a mapping
          [
            columnHelper(maybeWithTooltipWarningTitle("Unmapped"), "unmapped"),
            columnHelper(maybeWithTooltipWarningTitle("Mapped"), "mapped"),
          ]
        : // Otherwise, only show an ID column
          [columnHelper(maybeWithTooltipWarningTitle("ID"), "unmapped")];
    const columns = [
      columnHelper("", "name"),
      ...idColumns,
      columnHelper("Magnification", "resolution"),
    ];
    return (
      <Table
        size="small"
        dataSource={tableData}
        columns={columns}
        pagination={false}
        align="right"
      />
    );
  }

  handleAutoBrushChange = async (active: boolean) => {
    this.props.onChangeEnableAutoBrush(active);
    if (active) {
      Toast.info(
        "You enabled the experimental automatic brush feature. Activate the brush tool and use CTRL+Click to use it.",
      );
    }
  };

  maybeGetAutoBrushUi = () => {
    const { autoBrushReadyDatasets } = features();
    if (
      autoBrushReadyDatasets == null ||
      !autoBrushReadyDatasets.includes(this.props.dataset.name)
    ) {
      return null;
    }

    return (
      <SwitchSetting
        label={settingsLabels.autoBrush}
        value={this.props.isAutoBrushEnabled}
        onChange={value => {
          this.handleAutoBrushChange(value);
        }}
      />
    );
  };

  removeFallbackLayer = () => {
    Modal.confirm({
      title: messages["tracing.confirm_remove_fallback_layer.title"],
      content: (
        <div>
          <p>{messages["tracing.confirm_remove_fallback_layer.explanation"]}</p>
          <p>
            <b>{messages["tracing.confirm_remove_fallback_layer.notes"]}</b>
          </p>
        </div>
      ),
      onOk: async () => {
        this.props.onUnlinkFallbackLayer(this.props.tracing);
      },
      width: 600,
    });
  };

  getUnlinkFromFallbackLayerButton = () => (
    <Tooltip title="Unlink dataset's original segmentation layer">
      <StopOutlined
        onClick={() => {
          this.removeFallbackLayer();
        }}
      />
    </Tooltip>
  );

  renderVolumeSettings = () => {
    const isPublicViewMode = this.props.controlMode === ControlModeEnum.VIEW;
    const { tracing, brushSize, onChangeBrushSize, onChangeActiveCellId } = this.props;

    if (isPublicViewMode || tracing.volume == null) {
      return null;
    }

    const hasFallbackLayer = tracing.volume.fallbackLayer != null;

    const volumeTracing = enforceVolumeTracing(tracing);
    return (
      <div className="padded-tab-content" style={{ minWidth: 200 }}>
        <LogSliderSetting
          label={settingsLabels.brushSize}
          roundTo={0}
          min={userSettings.brushSize.minimum}
          max={userSettings.brushSize.maximum}
          step={5}
          value={brushSize}
          onChange={onChangeBrushSize}
        />
        {this.maybeGetAutoBrushUi()}
        <NumberInputSetting
          label="Active Cell ID"
          value={volumeTracing.activeCellId}
          onChange={onChangeActiveCellId}
        />
        {hasFallbackLayer ? this.getUnlinkFromFallbackLayerButton() : null}
      </div>
    );
  };

  render() {
    if (!hasSegmentation()) {
      return "No segmentation available";
    }

    return (
      <div id="volume-mapping-info" className="padded-tab-content" style={{ maxWidth: 500 }}>
        {this.renderIdTable()}
        {this.renderVolumeSettings()}
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeBrushSize(value) {
    dispatch(updateUserSettingAction("brushSize", value));
  },
  onChangeActiveCellId(id: number) {
    dispatch(setActiveCellAction(id));
  },
  onChangeEnableAutoBrush(active: boolean) {
    dispatch(updateTemporarySettingAction("isAutoBrushEnabled", active));
  },
  async onUnlinkFallbackLayer(tracing: Tracing) {
    const { annotationId, annotationType } = tracing;
    await unlinkFallbackSegmentation(annotationId, annotationType);
    await api.tracing.hardReload();
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    dataset: state.dataset,
    position: getPosition(state.flycam),
    isMappingEnabled: state.temporaryConfiguration.activeMapping.isMappingEnabled,
    mapping: state.temporaryConfiguration.activeMapping.mapping,
    mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
    mousePosition: state.temporaryConfiguration.mousePosition,
    activeViewport: state.viewModeData.plane.activeViewport,
    segmentationLayer: getSegmentationLayer(state.dataset),
    activeCellId: getVolumeTracing(state.tracing)
      .map(tracing => tracing.activeCellId)
      .getOrElse(0),
    brushSize: state.userConfiguration.brushSize,
    tracing: state.tracing,
    controlMode: state.temporaryConfiguration.controlMode,
    isAutoBrushEnabled: state.temporaryConfiguration.isAutoBrushEnabled,
  };
}

const debounceTime = 100;
const maxWait = 500;
export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(debounceRender(VolumeTabView, debounceTime, { maxWait }));
