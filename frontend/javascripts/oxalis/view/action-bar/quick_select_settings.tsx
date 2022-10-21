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

const OPTIONS_WITH_DISABLED = [
  { label: "Dark Segment", value: "dark" },
  { label: "Light Segment", value: "light" },
];

export function QuickSelectControls({ setIsOpen }: { setIsOpen: (val: boolean) => void }) {
  const isQuickSelectActive = useSelector(
    (state: OxalisState) => state.uiInformation.isQuickSelectActive,
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
        showPreview: quickSelectConfig.showPreview,
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

  const onChangeThreshold = (thresholdPercent: number) => {
    const threshold = (thresholdPercent / 100) * 256;
    const { segmentMode, dilateValue, closeValue, erodeValue } = quickSelectConfig;
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, threshold }));
    dispatch(
      fineTuneQuickSelectAction(segmentMode, threshold, closeValue, erodeValue, dilateValue),
    );
  };
  const onChangeSegmentMode = ({ target: { value } }: RadioChangeEvent) => {
    const segmentMode: "light" | "dark" = value;
    const { threshold, dilateValue, closeValue, erodeValue } = quickSelectConfig;
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, segmentMode }));
    dispatch(
      fineTuneQuickSelectAction(segmentMode, threshold, closeValue, erodeValue, dilateValue),
    );
  };
  const onChangeCloseValue = (closeValue: number) => {
    const { segmentMode, threshold, dilateValue, erodeValue } = quickSelectConfig;
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, closeValue }));
    dispatch(
      fineTuneQuickSelectAction(segmentMode, threshold, closeValue, erodeValue, dilateValue),
    );
  };
  const onChangeDilateValue = (dilateValue: number) => {
    const { segmentMode, threshold, closeValue, erodeValue } = quickSelectConfig;
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, dilateValue }));
    dispatch(
      fineTuneQuickSelectAction(segmentMode, threshold, closeValue, erodeValue, dilateValue),
    );
  };
  const onChangeErodeValue = (erodeValue: number) => {
    const { segmentMode, threshold, dilateValue, closeValue } = quickSelectConfig;
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, erodeValue }));
    dispatch(
      fineTuneQuickSelectAction(segmentMode, threshold, closeValue, erodeValue, dilateValue),
    );
  };
  const onChangeShowPreview = (showPreview: boolean) => {
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, showPreview }));
  };

  const onDiscard = () => {
    dispatch(cancelQuickSelectAction());
    setIsOpen(false);
  };
  const onConfirm = () => {
    dispatch(confirmQuickSelectAction());
    setIsOpen(false);
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
