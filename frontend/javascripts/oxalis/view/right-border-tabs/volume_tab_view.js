/**
 * tracing_settings_view.js
 * @flow
 */

import features from "features";
import type { Dispatch } from "redux";
import { Modal, Tooltip } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import { StopOutlined } from "@ant-design/icons";
import type { APIDataset } from "types/api_flow_types";
import {
  LogSliderSetting,
  NumberInputSetting,
  SwitchSetting,
} from "oxalis/view/components/setting_input_views";
import type { OxalisState, Tracing } from "oxalis/store";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import api from "oxalis/api/internal_api";
import { unlinkFallbackSegmentation } from "admin/admin_rest_api";
import messages, { settings as settingsLabels } from "messages";
import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import { type ControlMode, ControlModeEnum } from "oxalis/constants";
import Toast from "libs/toast";

type VolumeTabViewProps = {
  brushSize: number,
  tracing: Tracing,
  onChangeBrushSize: (value: any) => void,
  onChangeActiveCellId: (value: number) => void,
  onChangeEnableAutoBrush: (active: boolean) => void,
  onUnlinkFallbackLayer: Tracing => Promise<void>,
  isAutoBrushEnabled: boolean,
  controlMode: ControlMode,
  dataset: APIDataset,
};

function VolumeTabView(props: VolumeTabViewProps) {
  const { tracing } = props;

  async function handleAutoBrushChange(active: boolean) {
    props.onChangeEnableAutoBrush(active);
    if (active) {
      Toast.info(
        "You enabled the experimental automatic brush feature. Activate the brush tool and use CTRL+Click to use it.",
      );
    }
  }

  function maybeGetAutoBrushUi() {
    const { autoBrushReadyDatasets } = features();
    if (autoBrushReadyDatasets == null || !autoBrushReadyDatasets.includes(props.dataset.name)) {
      return null;
    }

    return (
      <SwitchSetting
        label={settingsLabels.autoBrush}
        value={props.isAutoBrushEnabled}
        onChange={value => {
          handleAutoBrushChange(value);
        }}
      />
    );
  }

  function removeFallbackLayer() {
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
        props.onUnlinkFallbackLayer(tracing);
      },
      width: 600,
    });
  }

  function getUnlinkFromFallbackLayerButton() {
    return (
      <Tooltip title="Unlink dataset's original segmentation layer">
        <StopOutlined
          onClick={() => {
            removeFallbackLayer();
          }}
        />
      </Tooltip>
    );
  }

  const isPublicViewMode = props.controlMode === ControlModeEnum.VIEW;

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
        value={props.brushSize}
        onChange={props.onChangeBrushSize}
      />
      {maybeGetAutoBrushUi()}
      <NumberInputSetting
        label="Active Cell ID"
        value={volumeTracing.activeCellId}
        onChange={props.onChangeActiveCellId}
      />
      {hasFallbackLayer ? getUnlinkFromFallbackLayerButton() : null}
    </div>
  );
}

const mapStateToProps = (state: OxalisState) => ({
  brushSize: state.userConfiguration.brushSize,
  tracing: state.tracing,
  controlMode: state.temporaryConfiguration.controlMode,
  isAutoBrushEnabled: state.temporaryConfiguration.isAutoBrushEnabled,
  dataset: state.dataset,
});

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

export default connect<VolumeTabViewProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(VolumeTabView);
