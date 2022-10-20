import { NumberSliderSetting, SwitchSetting } from "../components/setting_input_views";
import {
  cancelWatershedAction,
  confirmWatershedAction,
  fineTuneWatershedAction,
} from "oxalis/model/actions/volumetracing_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { useDispatch, useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import React from "react";
import ButtonComponent from "../components/button_component";
import defaultState from "oxalis/default_state";
import Shortcut from "libs/shortcut_component";
import { Radio, RadioChangeEvent } from "antd";

const OPTIONS_WITH_DISABLED = [
  { label: "Dark Segment", value: "dark" },
  { label: "Light Segment", value: "light" },
];

export function WatershedControls({ setIsOpen }: { setIsOpen: (val: boolean) => void }) {
  const isWatershedActive = useSelector(
    (state: OxalisState) => state.uiInformation.isWatershedActive,
  );
  const watershedConfig = useSelector((state: OxalisState) => state.userConfiguration.watershed);
  const dispatch = useDispatch();
  const { segmentMode, threshold, dilateValue, closeValue, erodeValue } = watershedConfig;
  const onResetValues = () => {
    const { segmentMode, threshold, closeValue, erodeValue, dilateValue } =
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
    dispatch(fineTuneWatershedAction(segmentMode, threshold, closeValue, erodeValue, dilateValue));
  };

  const onChangeThreshold = (threshold: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, threshold }));
    dispatch(fineTuneWatershedAction(segmentMode, threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeSegmentMode = ({ target: { value } }: RadioChangeEvent) => {
    const segmentMode: "light" | "dark" = value;
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, segmentMode }));
    dispatch(fineTuneWatershedAction(segmentMode, threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeCloseValue = (closeValue: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, closeValue }));
    dispatch(fineTuneWatershedAction(segmentMode, threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeDilateValue = (dilateValue: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, dilateValue }));
    dispatch(fineTuneWatershedAction(segmentMode, threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeErodeValue = (erodeValue: number) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, erodeValue }));
    dispatch(fineTuneWatershedAction(segmentMode, threshold, closeValue, erodeValue, dilateValue));
  };
  const onChangeShowPreview = (showPreview: boolean) => {
    dispatch(updateUserSettingAction("watershed", { ...watershedConfig, showPreview }));
  };

  const onDiscard = () => {
    dispatch(cancelWatershedAction());
    setIsOpen(false);
  };
  const onConfirm = () => {
    dispatch(confirmWatershedAction());
    setIsOpen(false);
  };

  return (
    <div>
      <SwitchSetting
        label="Show Preview"
        value={watershedConfig.showPreview}
        onChange={onChangeShowPreview}
      />
      <Radio.Group
        options={OPTIONS_WITH_DISABLED}
        onChange={onChangeSegmentMode}
        value={watershedConfig.segmentMode}
        optionType="button"
        size="small"
        buttonStyle="solid"
        disabled={!isWatershedActive}
      />
      <NumberSliderSetting
        label={"Threshold"}
        min={0}
        value={threshold}
        max={255}
        step={1}
        onChange={onChangeThreshold}
        disabled={!isWatershedActive}
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
          disabled={!isWatershedActive}
          size="small"
          title="Discard Preview (Escape)"
          onClick={onDiscard}
        >
          Discard
        </ButtonComponent>
        <ButtonComponent
          disabled={!isWatershedActive}
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
