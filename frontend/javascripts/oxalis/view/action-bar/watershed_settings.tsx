import { NumberSliderSetting, SwitchSetting } from "../components/setting_input_views";
import { fineTuneWatershedAction } from "oxalis/model/actions/volumetracing_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { useDispatch, useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import React from "react";
import ButtonComponent from "../components/button_component";
import defaultState from "oxalis/default_state";

export function WatershedControls() {
  const watershedConfig = useSelector((state: OxalisState) => state.userConfiguration.watershed);
  const dispatch = useDispatch();
  const { threshold, dilateValue, closeValue, erodeValue } = watershedConfig;
  const onResetValues = () => {
    const { threshold, closeValue, erodeValue, dilateValue } =
      defaultState.userConfiguration.watershed;
    dispatch(
      updateUserSettingAction("watershed", {
        showPreview: watershedConfig.showPreview,
        threshold,
        closeValue,
        erodeValue,
        dilateValue,
      }),
    );
    dispatch(fineTuneWatershedAction(threshold, closeValue, erodeValue, dilateValue));
  };

  const onChangeThreshold = (threshold: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, threshold }));
    dispatch(fineTuneWatershedAction(threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeCloseValue = (closeValue: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, closeValue }));
    dispatch(fineTuneWatershedAction(threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeDilateValue = (dilateValue: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, dilateValue }));
    dispatch(fineTuneWatershedAction(threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeErodeValue = (erodeValue: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, erodeValue }));
    dispatch(fineTuneWatershedAction(threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeShowPreview = (showPreview: boolean) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, showPreview }));
  };

  return (
    <div>
      <SwitchSetting
        label="Show Preview"
        value={watershedConfig.showPreview}
        onChange={onChangeShowPreview}
      />
      <NumberSliderSetting
        label={"Threshold"}
        min={0}
        value={threshold}
        max={255}
        step={1}
        onChange={onChangeThreshold}
      />
      <NumberSliderSetting
        label={"Close"}
        min={0}
        value={closeValue}
        max={10}
        step={1}
        onChange={onChangeCloseValue}
      />
      <NumberSliderSetting
        label={"Erode"}
        min={0}
        value={erodeValue}
        max={10}
        step={1}
        onChange={onChangeErodeValue}
      />
      <NumberSliderSetting
        label={"Dilate"}
        min={0}
        value={dilateValue}
        max={10}
        step={1}
        onChange={onChangeDilateValue}
      />
      <div style={{ display: "flex", justifyContent: "center" }}>
        <ButtonComponent size="small" onClick={onResetValues}>
          Reset Values
        </ButtonComponent>
      </div>
    </div>
  );
}
