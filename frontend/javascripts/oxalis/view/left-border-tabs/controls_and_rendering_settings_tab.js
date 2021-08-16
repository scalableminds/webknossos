/**
 * tracing_settings_view.js
 * @flow
 */

import { Collapse, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import {
  LogSliderSetting,
  NumberSliderSetting,
  SwitchSetting,
  DropdownSetting,
} from "oxalis/view/components/setting_input_views";

import type { UserConfiguration, OxalisState, DatasetConfiguration } from "oxalis/store";
import { clearCache } from "admin/admin_rest_api";
import { getValidZoomRangeForUser } from "oxalis/model/accessors/flycam_accessor";
import {
  updateDatasetSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { getGpuFactorsWithLabels } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import messages, { settings as settingsLabels } from "messages";

import { userSettings } from "types/schemas/user_settings.schema";
import Constants, { type ViewMode } from "oxalis/constants";
import api from "oxalis/api/internal_api";
import Toast from "libs/toast";

const { Panel } = Collapse;

type ControlsAndRenderingSettingsTabProps = {
  userConfiguration: UserConfiguration,
  zoomStep: number,
  validZoomRange: [number, number],
  datasetConfiguration: DatasetConfiguration,
  onChangeUser: (key: $Keys<UserConfiguration>, value: any) => void,
  onChangeDataset: (key: $Keys<DatasetConfiguration>, value: any) => void,
  onChangeZoomStep: (value: number) => void,
  viewMode: ViewMode,
  dataset: APIDataset,
};

class ControlsAndRenderingSettingsTab extends PureComponent<ControlsAndRenderingSettingsTabProps> {
  onChangeUser: { [$Keys<UserConfiguration>]: Function };
  onChangeDataset: { [$Keys<DatasetConfiguration>]: Function };

  componentWillMount() {
    // cache onChange handler
    this.onChangeUser = _.mapValues(this.props.userConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeUser, propertyName),
    );
    this.onChangeDataset = _.mapValues(this.props.datasetConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeDataset, propertyName),
    );
  }

  getViewportOptions = () => {
    switch (this.props.viewMode) {
      case Constants.MODE_PLANE_TRACING:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting
              label={
                <Tooltip title="Zoom in or out in the data viewports">
                  {settingsLabels.zoom}
                </Tooltip>
              }
              roundTo={3}
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <SwitchSetting
              label={
                <Tooltip title="Show crosshair lines in each viewport, with colors indicating the other viewports">
                  {settingsLabels.displayCrosshair}
                </Tooltip>
              }
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={
                <Tooltip title="Show a scale in the lower-right corner of each viewport">
                  {settingsLabels.displayScalebars}
                </Tooltip>
              }
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
          </Panel>
        );
      case Constants.MODE_VOLUME:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting
              label={
                <Tooltip title="Zoom in or out in the data viewports">
                  {settingsLabels.zoom}
                </Tooltip>
              }
              roundTo={3}
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <SwitchSetting
              label={
                <Tooltip title="Show crosshair lines in each viewport, with colors indicating the other viewports">
                  {settingsLabels.displayCrosshair}
                </Tooltip>
              }
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={
                <Tooltip title="Show a scale in the lower-right corner of each viewport">
                  {settingsLabels.displayScalebars}
                </Tooltip>
              }
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
          </Panel>
        );
      default:
        return (
          <Panel header="Flight Options" key="2">
            <LogSliderSetting
              label={
                <Tooltip title="Zoom in or out in the data viewport">{settingsLabels.zoom}</Tooltip>
              }
              roundTo={3}
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <NumberSliderSetting
              label={
                <Tooltip title="Rotation speed when using the mouse to drag the rotation.">
                  {settingsLabels.mouseRotateValue}
                </Tooltip>
              }
              min={userSettings.mouseRotateValue.minimum}
              max={userSettings.mouseRotateValue.maximum}
              step={0.001}
              value={this.props.userConfiguration.mouseRotateValue}
              onChange={this.onChangeUser.mouseRotateValue}
            />
            <NumberSliderSetting
              label={
                <Tooltip title="Rotation speed when using the arrow keys on the keyboard">
                  {settingsLabels.rotateValue}
                </Tooltip>
              }
              min={userSettings.rotateValue.minimum}
              max={userSettings.rotateValue.maximum}
              step={0.001}
              value={this.props.userConfiguration.rotateValue}
              onChange={this.onChangeUser.rotateValue}
            />
            <NumberSliderSetting
              label={
                <Tooltip title="Size of the crosshair marker in the viewing direction center">
                  {settingsLabels.crosshairSize}
                </Tooltip>
              }
              min={userSettings.crosshairSize.minimum}
              max={userSettings.crosshairSize.maximum}
              step={0.01}
              value={this.props.userConfiguration.crosshairSize}
              onChange={this.onChangeUser.crosshairSize}
            />
            <NumberSliderSetting
              label={
                <Tooltip title="Set the radius of the spherical cap the data is projected on.">
                  {settingsLabels.sphericalCapRadius}
                </Tooltip>
              }
              min={userSettings.sphericalCapRadius.minimum}
              max={userSettings.sphericalCapRadius.maximum}
              step={1}
              value={this.props.userConfiguration.sphericalCapRadius}
              onChange={this.onChangeUser.sphericalCapRadius}
            />
            <SwitchSetting
              label={
                <Tooltip title="Show crosshair marker in the viewing direction center">
                  {settingsLabels.displayCrosshair}
                </Tooltip>
              }
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
          </Panel>
        );
    }
  };

  onChangeGpuFactor = (gpuFactor: number) => {
    Toast.warning("Please reload the page to allow the changes to take effect.");
    this.onChangeUser.gpuMemoryFactor(gpuFactor);
  };

  onChangeRenderMissingDataBlack = async (value: boolean): Promise<void> => {
    Toast.info(
      value
        ? messages["data.enabled_render_missing_data_black"]
        : messages["data.disabled_render_missing_data_black"],
      { timeout: 8000 },
    );
    this.onChangeDataset.renderMissingDataBlack(value);
    const { layers } = this.props.datasetConfiguration;
    const reloadAllLayersPromises = Object.keys(layers).map(async layerName => {
      await clearCache(this.props.dataset, layerName);
      await api.data.reloadBuckets(layerName);
    });
    await Promise.all(reloadAllLayersPromises);
    window.needsRerender = true;
    Toast.success("Successfully reloaded data of all layers.");
  };

  render() {
    const moveValueSetting = Constants.MODES_ARBITRARY.includes(this.props.viewMode) ? (
      <NumberSliderSetting
        label={
          <Tooltip title="Increase to speed up movement through the dataset when holding d/f/space.">
            {settingsLabels.moveValue3d}
          </Tooltip>
        }
        min={userSettings.moveValue3d.minimum}
        max={userSettings.moveValue3d.maximum}
        step={10}
        value={this.props.userConfiguration.moveValue3d}
        onChange={this.onChangeUser.moveValue3d}
      />
    ) : (
      <NumberSliderSetting
        label={
          <Tooltip title="Increase to speed up movement through the dataset when holding d/f/space.">
            {settingsLabels.moveValue}
          </Tooltip>
        }
        min={userSettings.moveValue.minimum}
        max={userSettings.moveValue.maximum}
        step={10}
        value={this.props.userConfiguration.moveValue}
        onChange={this.onChangeUser.moveValue}
      />
    );

    return (
      <Collapse
        bordered={false}
        defaultActiveKey={["1", "2", "3"]}
        className="tracing-settings-menu"
        style={{ padding: 0 }}
      >
        <Panel header="Controls" key="1">
          <NumberSliderSetting
            label={
              <Tooltip title="Delay after which shortcut keys (e.g. d/f for moving) are assumed to be intentionally held down, so that continuous movement is triggered.">
                {settingsLabels.keyboardDelay}
              </Tooltip>
            }
            min={userSettings.keyboardDelay.minimum}
            max={userSettings.keyboardDelay.maximum}
            value={this.props.userConfiguration.keyboardDelay}
            onChange={this.onChangeUser.keyboardDelay}
          />
          {moveValueSetting}
          <SwitchSetting
            label={
              <Tooltip title="When enabled, the move direction (shortcuts d/f) changes dynamically to match the direction of the last two created nodes">
                {settingsLabels.dynamicSpaceDirection}
              </Tooltip>
            }
            value={this.props.userConfiguration.dynamicSpaceDirection}
            onChange={this.onChangeUser.dynamicSpaceDirection}
          />
          <SwitchSetting
            label={
              <Tooltip title="When enabled, right-click does not open the context menu in some tools, but instead triggers actions, such as creating nodes or erasing volume data. This setting is only recommended when having experience with these classic mouse and keyboard bindings.">
                {settingsLabels.useLegacyBindings}
              </Tooltip>
            }
            value={this.props.userConfiguration.useLegacyBindings}
            onChange={this.onChangeUser.useLegacyBindings}
          />
        </Panel>
        {this.getViewportOptions()}
        <Panel header="Data Rendering" key="3">
          <DropdownSetting
            label={
              <Tooltip title="Controls which data resolution is displayed, depending on zoom step and viewport size. Adapt this setting to your hardware, so that rendering quality and performance are balanced. Medium is the default. Choosing a higher setting can result in poor performance.">
                {settingsLabels.gpuMemoryFactor}
              </Tooltip>
            }
            value={(
              this.props.userConfiguration.gpuMemoryFactor || Constants.DEFAULT_GPU_MEMORY_FACTOR
            ).toString()}
            onChange={this.onChangeGpuFactor}
            options={getGpuFactorsWithLabels().map(([factor, label]) => ({
              label,
              value: factor.toString(),
            }))}
          />
          <DropdownSetting
            label={
              <Tooltip title={settingsLabels.loadingStrategyDescription}>
                {settingsLabels.loadingStrategy}
              </Tooltip>
            }
            value={this.props.datasetConfiguration.loadingStrategy}
            onChange={this.onChangeDataset.loadingStrategy}
            options={[
              { value: "BEST_QUALITY_FIRST", label: "Best quality first" },
              { value: "PROGRESSIVE_QUALITY", label: "Progressive quality" },
            ]}
          />
          <SwitchSetting
            label={
              <Tooltip title="Decrease size of transferred data by half, using lossy compression. Recommended for poor and/or capped internet connections.">
                {settingsLabels.fourBit}
              </Tooltip>
            }
            value={this.props.datasetConfiguration.fourBit}
            onChange={this.onChangeDataset.fourBit}
          />
          {Constants.MODES_ARBITRARY.includes(this.props.viewMode) ? null : (
            <SwitchSetting
              label={
                <Tooltip title="Smooth the rendered data by interpolating color values, depending on zoom step">
                  {settingsLabels.interpolation}
                </Tooltip>
              }
              value={this.props.datasetConfiguration.interpolation}
              onChange={this.onChangeDataset.interpolation}
            />
          )}
          <SwitchSetting
            label={
              <Tooltip title="If disabled, missing data will be rendered by using downsampled resolutions.">
                {settingsLabels.renderMissingDataBlack}{" "}
              </Tooltip>
            }
            value={this.props.datasetConfiguration.renderMissingDataBlack}
            onChange={this.onChangeRenderMissingDataBlack}
          />
        </Panel>
      </Collapse>
    );
  }
}

// Reuse last range if it's equal to the current one to avoid unnecessary
// render() executions
let lastValidZoomRange = null;
function _getValidZoomRangeForUser(state) {
  const newRange = getValidZoomRangeForUser(state);

  if (
    !lastValidZoomRange ||
    newRange[0] !== lastValidZoomRange[0] ||
    newRange[1] !== lastValidZoomRange[1]
  ) {
    lastValidZoomRange = newRange;
  }
  return lastValidZoomRange;
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  zoomStep: state.flycam.zoomStep,
  validZoomRange: _getValidZoomRangeForUser(state),
  viewMode: state.temporaryConfiguration.viewMode,
  datasetConfiguration: state.datasetConfiguration,
  dataset: state.dataset,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeUser(propertyName, value) {
    dispatch(updateUserSettingAction(propertyName, value));
  },
  onChangeDataset(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
  onChangeZoomStep(zoomStep: number) {
    dispatch(setZoomStepAction(zoomStep));
  },
});

export default connect<ControlsAndRenderingSettingsTabProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ControlsAndRenderingSettingsTab);
