import {
  cancelQuickSelectAction,
  confirmQuickSelectAction,
  fineTuneQuickSelectAction,
} from "oxalis/model/actions/volumetracing_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { useDispatch, useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import React from "react";
import defaultState from "oxalis/default_state";
import Shortcut from "libs/shortcut_component";
import { Radio, RadioChangeEvent } from "antd";
import { NumberSliderSetting, SwitchSetting } from "../components/setting_input_views";
import ButtonComponent from "../components/button_component";
import { showQuickSelectSettingsAction } from "oxalis/model/actions/ui_actions";

const OPTIONS_WITH_DISABLED = [
  { label: "Dark Segment", value: "dark" },
  { label: "Light Segment", value: "light" },
];

export function QuickSelectControls() {
  const isQuickSelectActive = useSelector(
    (state: OxalisState) => state.uiInformation.quickSelectState === "active",
  );
  const quickSelectConfig = useSelector(
    (state: OxalisState) => state.userConfiguration.quickSelect,
  );
  const dispatch = useDispatch();

  const onResetValues = () => {
    const { segmentMode, threshold, closeValue, erodeValue, dilateValue } =
      defaultState.userConfiguration.quickSelect;
    dispatch(
      updateUserSettingAction("quickSelect", {
        useHeuristic: true,
        showPreview: quickSelectConfig.showPreview,
        segmentMode,
        threshold,
        closeValue,
        erodeValue,
        dilateValue,
      }),
    );
    dispatch(
      fineTuneQuickSelectAction(segmentMode, threshold, closeValue, erodeValue, dilateValue),
    );
  };

  const onChangeProperty = (
    property: keyof typeof quickSelectConfig,
    value: number | "dark" | "light",
  ) => {
    const conf = { ...quickSelectConfig, [property]: value };
    dispatch(updateUserSettingAction("quickSelect", conf));
    dispatch(
      fineTuneQuickSelectAction(
        conf.segmentMode,
        conf.threshold,
        conf.closeValue,
        conf.erodeValue,
        conf.dilateValue,
      ),
    );
  };

  const onChangeThreshold = (thresholdPercent: number) => {
    const threshold = (thresholdPercent / 100) * 256;
    onChangeProperty("threshold", threshold);
  };
  const onChangeSegmentMode = ({ target: { value } }: RadioChangeEvent) =>
    onChangeProperty("segmentMode", value as "dark" | "light");
  const onChangeCloseValue = (value: number) => onChangeProperty("closeValue", value);
  const onChangeDilateValue = (value: number) => onChangeProperty("dilateValue", value);
  const onChangeErodeValue = (value: number) => onChangeProperty("erodeValue", value);

  const onChangeShowPreview = (showPreview: boolean) => {
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, showPreview }));
  };

  const onDiscard = () => {
    dispatch(cancelQuickSelectAction());
    dispatch(showQuickSelectSettingsAction(false));
  };
  const onConfirm = () => {
    dispatch(confirmQuickSelectAction());
    dispatch(showQuickSelectSettingsAction(false));
  };

  return (
    <div>
      <SwitchSetting
        label="Show Preview"
        value={quickSelectConfig.showPreview}
        onChange={onChangeShowPreview}
      />
      <Radio.Group
        options={OPTIONS_WITH_DISABLED}
        onChange={onChangeSegmentMode}
        value={quickSelectConfig.segmentMode}
        optionType="button"
        size="small"
        buttonStyle="solid"
        disabled={!isQuickSelectActive}
      />
      <NumberSliderSetting
        label="Threshold [%]"
        min={0}
        value={(quickSelectConfig.threshold / 256) * 100}
        max={100}
        step={0.25} // a granular step is important so that all 256 values can be effectively targeted
        onChange={onChangeThreshold}
        disabled={!isQuickSelectActive}
      />
      <NumberSliderSetting
        label="Close [vx]"
        min={0}
        value={quickSelectConfig.closeValue}
        max={10}
        step={1}
        onChange={onChangeCloseValue}
      />
      <NumberSliderSetting
        label="Erode [vx]"
        min={0}
        value={quickSelectConfig.erodeValue}
        max={10}
        step={1}
        onChange={onChangeErodeValue}
      />
      <NumberSliderSetting
        label="Dilate [vx]"
        min={0}
        value={quickSelectConfig.dilateValue}
        max={10}
        step={1}
        onChange={onChangeDilateValue}
      />
      <Shortcut supportInputElements keys="escape" onTrigger={onDiscard} />
      <Shortcut supportInputElements keys="enter" onTrigger={onConfirm} />
      <div style={{ marginTop: "1rem", display: "flex", justifyContent: "center", gap: "0.5rem" }}>
        <ButtonComponent
          size="small"
          onClick={onResetValues}
          title="Reset values to their defaults"
        >
          Reset
        </ButtonComponent>
        <ButtonComponent
          disabled={!isQuickSelectActive}
          size="small"
          title="Discard Preview (Escape)"
          onClick={onDiscard}
        >
          Discard
        </ButtonComponent>
        <ButtonComponent
          disabled={!isQuickSelectActive}
          size="small"
          type="primary"
          title="Accept Preview (Enter)"
          onClick={onConfirm}
        >
          Accept
        </ButtonComponent>
      </div>
    </div>
  );
}
