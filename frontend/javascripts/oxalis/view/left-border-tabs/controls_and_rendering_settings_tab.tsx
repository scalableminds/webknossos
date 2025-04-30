import { ExclamationCircleOutlined } from "@ant-design/icons";
import { clearCache } from "admin/admin_rest_api";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { Collapse, type CollapseProps } from "antd";
import FastTooltip from "components/fast_tooltip";
import { PricingEnforcedSwitchSetting } from "components/pricing_enforcers";
import Toast from "libs/toast";
import _ from "lodash";
import messages, { settingsTooltips, settings as settingsLabels } from "messages";
import type { ViewMode } from "oxalis/constants";
import Constants, { BLEND_MODES } from "oxalis/constants";
import defaultState from "oxalis/default_state";
import { getValidZoomRangeForUser } from "oxalis/model/accessors/flycam_accessor";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { getGpuFactorsWithLabels } from "oxalis/model/bucket_data_handling/data_rendering_logic";
import { api } from "oxalis/singletons";
import type { DatasetConfiguration, UserConfiguration, WebknossosState } from "oxalis/store";
import {
  DropdownSetting,
  LogSliderSetting,
  NumberSliderSetting,
  SwitchSetting,
} from "oxalis/view/components/setting_input_views";
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import type { APIDataset, APIUser } from "types/api_types";
import type { ArrayElement } from "types/globals";
import { userSettings } from "types/schemas/user_settings.schema";

type ControlsAndRenderingSettingsTabProps = {
  activeUser: APIUser | null | undefined;
  userConfiguration: UserConfiguration;
  zoomStep: number;
  validZoomRange: [number, number];
  datasetConfiguration: DatasetConfiguration;
  onChangeUser: (key: keyof UserConfiguration, value: any) => void;
  onChangeDataset: (key: keyof DatasetConfiguration, value: any) => void;
  onChangeZoomStep: (value: number) => void;
  viewMode: ViewMode;
  dataset: APIDataset;
};

function askUserToReload() {
  Toast.warning("Please reload the page to allow the changes to take full effect.", {
    sticky: true,
  });
}

const PERFORMANCE_WARNING_ICON = (
  <ExclamationCircleOutlined style={{ marginLeft: 8, color: "orange", verticalAlign: "middle" }} />
);

class ControlsAndRenderingSettingsTab extends PureComponent<ControlsAndRenderingSettingsTabProps> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'onChangeUser' has no initializer and is ... Remove this comment to see the full error message
  onChangeUser: Record<keyof UserConfiguration, (...args: Array<any>) => any>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'onChangeDataset' has no initializer and ... Remove this comment to see the full error message
  onChangeDataset: Record<keyof DatasetConfiguration, (...args: Array<any>) => any>;

  // This cannot be changed to componentDidMount, because this.onChangeUser is accessed in render
  UNSAFE_componentWillMount() {
    // cache onChange handler
    // @ts-expect-error ts-migrate(2740) FIXME: Type 'Dictionary<boolean>' is missing the following... Remove this comment to see the full error message
    this.onChangeUser = _.mapValues(
      this.props.userConfiguration,
      (__, propertyName: keyof UserConfiguration) =>
        _.partial(this.props.onChangeUser, propertyName),
    );
    // @ts-expect-error ts-migrate(2322) FIXME: Type '{ readonly fourBit: Function1<keyof DatasetC... Remove this comment to see the full error message
    this.onChangeDataset = _.mapValues(this.props.datasetConfiguration, (__, propertyName) =>
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
      _.partial(this.props.onChangeDataset, propertyName),
    );
  }

  getViewportOptions = (): ArrayElement<CollapseProps["items"]> => {
    if (
      this.props.viewMode === Constants.MODE_ARBITRARY ||
      this.props.viewMode === Constants.MODE_ARBITRARY_PLANE
    ) {
      return {
        label: "Flight Options",
        key: "2",
        children: (
          <React.Fragment>
            <LogSliderSetting
              label={<FastTooltip title={settingsTooltips.zoom}>{settingsLabels.zoom}</FastTooltip>}
              roundTo={3}
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
              defaultValue={defaultState.flycam.zoomStep}
            />
            <NumberSliderSetting
              label={
                <FastTooltip title={settingsTooltips.mouseRotateValue}>
                  {settingsLabels.mouseRotateValue}
                </FastTooltip>
              }
              min={userSettings.mouseRotateValue.minimum}
              max={userSettings.mouseRotateValue.maximum}
              step={0.001}
              value={this.props.userConfiguration.mouseRotateValue}
              onChange={this.onChangeUser.mouseRotateValue}
              defaultValue={defaultState.userConfiguration.mouseRotateValue}
            />
            <NumberSliderSetting
              label={
                <FastTooltip title={settingsTooltips.rotateValue}>
                  {settingsLabels.rotateValue}
                </FastTooltip>
              }
              min={userSettings.rotateValue.minimum}
              max={userSettings.rotateValue.maximum}
              step={0.001}
              value={this.props.userConfiguration.rotateValue}
              onChange={this.onChangeUser.rotateValue}
              defaultValue={defaultState.userConfiguration.rotateValue}
            />
            <NumberSliderSetting
              label={
                <FastTooltip title={settingsTooltips.crosshairSize}>
                  {settingsLabels.crosshairSize}
                </FastTooltip>
              }
              min={userSettings.crosshairSize.minimum}
              max={userSettings.crosshairSize.maximum}
              step={0.01}
              value={this.props.userConfiguration.crosshairSize}
              onChange={this.onChangeUser.crosshairSize}
              defaultValue={defaultState.userConfiguration.crosshairSize}
            />
            <NumberSliderSetting
              label={
                <FastTooltip title={settingsTooltips.sphericalCapRadius}>
                  {settingsLabels.sphericalCapRadius}
                </FastTooltip>
              }
              min={userSettings.sphericalCapRadius.minimum}
              max={userSettings.sphericalCapRadius.maximum}
              step={1}
              value={this.props.userConfiguration.sphericalCapRadius}
              onChange={this.onChangeUser.sphericalCapRadius}
              defaultValue={defaultState.userConfiguration.sphericalCapRadius}
            />
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.displayCrosshair}>
                  {settingsLabels.displayCrosshair}
                </FastTooltip>
              }
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
          </React.Fragment>
        ),
      };
    } else {
      return {
        label: "Viewport Options",
        key: "2",
        children: (
          <React.Fragment>
            <LogSliderSetting
              label={<FastTooltip title={settingsTooltips.zoom}>{settingsLabels.zoom}</FastTooltip>}
              roundTo={3}
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
              defaultValue={defaultState.flycam.zoomStep}
            />
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.displayCrosshair}>
                  {settingsLabels.displayCrosshair}
                </FastTooltip>
              }
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.displayScalebars}>
                  {settingsLabels.displayScalebars}
                </FastTooltip>
              }
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
            <PricingEnforcedSwitchSetting
              label={
                <FastTooltip title={settingsTooltips.renderWatermark}>
                  {settingsLabels.renderWatermark}
                </FastTooltip>
              }
              value={this.props.userConfiguration.renderWatermark}
              onChange={this.onChangeUser.renderWatermark}
              requiredPricingPlan={PricingPlanEnum.Team}
              defaultValue={true}
            />
          </React.Fragment>
        ),
      };
    }
  };

  onChangeGpuFactor = (gpuFactor: number) => {
    askUserToReload();
    this.onChangeUser.gpuMemoryFactor(gpuFactor);
  };

  onChangeRenderMissingDataBlack = async (value: boolean): Promise<void> => {
    Toast.info(
      value
        ? messages["data.enabled_render_missing_data_black"]
        : messages["data.disabled_render_missing_data_black"],
      {
        timeout: 8000,
      },
    );
    this.onChangeDataset.renderMissingDataBlack(value);
    const { layers } = this.props.datasetConfiguration;
    const reloadAllLayersPromises = Object.keys(layers).map(async (layerName) => {
      if (this.props.activeUser) {
        // Only registered users may clear the server's cache
        await clearCache(this.props.dataset, layerName);
      }
      await api.data.reloadBuckets(layerName);
    });
    await Promise.all(reloadAllLayersPromises);
    Toast.success("Successfully reloaded data of all layers.");
  };

  render() {
    const moveValueSetting = Constants.MODES_ARBITRARY.includes(this.props.viewMode) ? (
      <NumberSliderSetting
        label={
          <FastTooltip title={settingsTooltips.moveValue}>{settingsLabels.moveValue}</FastTooltip>
        }
        min={userSettings.moveValue3d.minimum}
        max={userSettings.moveValue3d.maximum}
        step={10}
        value={this.props.userConfiguration.moveValue3d}
        onChange={this.onChangeUser.moveValue3d}
        defaultValue={defaultState.userConfiguration.moveValue3d}
      />
    ) : (
      <NumberSliderSetting
        label={
          <FastTooltip title={settingsTooltips.moveValue}>{settingsLabels.moveValue}</FastTooltip>
        }
        min={userSettings.moveValue.minimum}
        max={userSettings.moveValue.maximum}
        step={10}
        value={this.props.userConfiguration.moveValue}
        onChange={this.onChangeUser.moveValue}
        defaultValue={defaultState.userConfiguration.moveValue}
      />
    );

    const collapseItems: CollapseProps["items"] = [
      {
        label: "Controls",
        key: "1",
        children: (
          <React.Fragment>
            <NumberSliderSetting
              label={
                <FastTooltip title={settingsTooltips.keyboardDelay}>
                  {settingsLabels.keyboardDelay}
                </FastTooltip>
              }
              min={userSettings.keyboardDelay.minimum}
              max={userSettings.keyboardDelay.maximum}
              value={this.props.userConfiguration.keyboardDelay}
              onChange={this.onChangeUser.keyboardDelay}
              defaultValue={defaultState.userConfiguration.keyboardDelay}
            />
            {moveValueSetting}
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.dynamicSpaceDirection}>
                  {settingsLabels.dynamicSpaceDirection}
                </FastTooltip>
              }
              value={this.props.userConfiguration.dynamicSpaceDirection}
              onChange={this.onChangeUser.dynamicSpaceDirection}
            />
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.useLegacyBindings}>
                  {settingsLabels.useLegacyBindings}
                </FastTooltip>
              }
              value={this.props.userConfiguration.useLegacyBindings}
              onChange={this.onChangeUser.useLegacyBindings}
            />
          </React.Fragment>
        ),
      },
      this.getViewportOptions(),
      {
        label: "Data Rendering",
        key: "3",
        children: (
          <React.Fragment>
            {" "}
            <DropdownSetting
              label={
                <FastTooltip title={settingsTooltips.gpuMemoryFactor}>
                  {settingsLabels.gpuMemoryFactor}
                </FastTooltip>
              }
              value={(
                this.props.userConfiguration.gpuMemoryFactor || Constants.DEFAULT_GPU_MEMORY_FACTOR
              ).toString()}
              onChange={this.onChangeGpuFactor}
              disabled={this.props.activeUser == null}
              disabledReason={
                this.props.activeUser == null ? "Log in to change this setting." : null
              }
              options={getGpuFactorsWithLabels().map(([factor, label]) => ({
                label,
                value: factor.toString(),
              }))}
            />
            <DropdownSetting
              label={
                <FastTooltip title={settingsTooltips.loadingStrategy}>
                  {settingsLabels.loadingStrategy}
                </FastTooltip>
              }
              value={this.props.datasetConfiguration.loadingStrategy}
              onChange={this.onChangeDataset.loadingStrategy}
              options={[
                {
                  value: "BEST_QUALITY_FIRST",
                  label: "Best quality first",
                },
                {
                  value: "PROGRESSIVE_QUALITY",
                  label: "Progressive quality",
                },
              ]}
            />
            <DropdownSetting
              label={
                <FastTooltip title={settingsTooltips.blendMode}>
                  {settingsLabels.blendMode}
                </FastTooltip>
              }
              value={this.props.datasetConfiguration.blendMode}
              onChange={this.onChangeDataset.blendMode}
              options={[
                {
                  value: BLEND_MODES.Additive,
                  label: "Additive",
                },
                {
                  value: BLEND_MODES.Cover,
                  label: "Cover",
                },
              ]}
            />
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.fourBit}>{settingsLabels.fourBit}</FastTooltip>
              }
              value={this.props.datasetConfiguration.fourBit}
              onChange={this.onChangeDataset.fourBit}
            />
            {Constants.MODES_ARBITRARY.includes(this.props.viewMode) ? null : (
              <div>
                <SwitchSetting
                  label={
                    <FastTooltip title={settingsTooltips.interpolation}>
                      {settingsLabels.interpolation}
                    </FastTooltip>
                  }
                  value={this.props.datasetConfiguration.interpolation}
                  onChange={this.onChangeDataset.interpolation}
                >
                  {this.props.datasetConfiguration.interpolation && (
                    <FastTooltip title="Consider disabling interpolation if you notice degraded rendering performance.">
                      {PERFORMANCE_WARNING_ICON}
                    </FastTooltip>
                  )}
                </SwitchSetting>
              </div>
            )}
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.antialiasRendering}>
                  {settingsLabels.antialiasRendering}
                </FastTooltip>
              }
              value={this.props.userConfiguration.antialiasRendering}
              disabled={this.props.activeUser == null}
              disabledReason={
                this.props.activeUser == null ? "Log in to change this setting." : null
              }
              onChange={(arg) => {
                askUserToReload();
                this.onChangeUser.antialiasRendering(arg);
              }}
            >
              {this.props.userConfiguration.antialiasRendering && (
                <FastTooltip title="Consider disabling antialiasing if you notice degraded rendering performance.">
                  {PERFORMANCE_WARNING_ICON}
                </FastTooltip>
              )}
            </SwitchSetting>
            <SwitchSetting
              label={
                <FastTooltip title={settingsTooltips.renderMissingDataBlack}>
                  {settingsLabels.renderMissingDataBlack}{" "}
                </FastTooltip>
              }
              value={this.props.datasetConfiguration.renderMissingDataBlack}
              onChange={this.onChangeRenderMissingDataBlack}
            />
          </React.Fragment>
        ),
      },
    ];

    return (
      <Collapse
        bordered={false}
        defaultActiveKey={["1", "2", "3"]}
        className="tracing-settings-menu"
        style={{
          padding: 0,
        }}
        items={collapseItems}
      />
    );
  }
}

const mapStateToProps = (state: WebknossosState) => ({
  activeUser: state.activeUser,
  userConfiguration: state.userConfiguration,
  zoomStep: state.flycam.zoomStep,
  validZoomRange: getValidZoomRangeForUser(state),
  viewMode: state.temporaryConfiguration.viewMode,
  datasetConfiguration: state.datasetConfiguration,
  dataset: state.dataset,
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onChangeUser(propertyName: keyof UserConfiguration, value: any) {
    dispatch(updateUserSettingAction(propertyName, value));
  },

  onChangeDataset(propertyName: keyof DatasetConfiguration, value: any) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },

  onChangeZoomStep(zoomStep: number) {
    dispatch(setZoomStepAction(zoomStep));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(ControlsAndRenderingSettingsTab);
