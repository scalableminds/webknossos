import { QuestionCircleOutlined } from "@ant-design/icons";
import { Radio, type RadioChangeEvent } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Shortcut from "libs/shortcut_component";
import defaultState from "oxalis/default_state";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { showQuickSelectSettingsAction } from "oxalis/model/actions/ui_actions";
import {
  cancelQuickSelectAction,
  confirmQuickSelectAction,
  fineTuneQuickSelectAction,
} from "oxalis/model/actions/volumetracing_actions";
import { useDispatch } from "react-redux";
import ButtonComponent from "../components/button_component";
import { NumberSliderSetting, SwitchSetting } from "../components/setting_input_views";

// The maximum depth of 16 also needs to be adapted in the back-end
// (at the time of writing, in segmentAnythingMask in DatasetController.scala).
const MAX_DEPTH_FOR_SAM = 16;

const OPTIONS_WITH_DISABLED = [
  { label: "Dark Segment", value: "dark" },
  { label: "Light Segment", value: "light" },
];

export function QuickSelectControls() {
  const quickSelectConfig = useWkSelector((state) => state.userConfiguration.quickSelect);
  const isAISelectAvailable = features().segmentAnythingEnabled;
  const isQuickSelectHeuristic = quickSelectConfig.useHeuristic || !isAISelectAvailable;

  return isQuickSelectHeuristic ? <HeuristicQuickSelectControls /> : <AiQuickSelectControls />;
}

export function AiQuickSelectControls() {
  const quickSelectConfig = useWkSelector((state) => state.userConfiguration.quickSelect);

  const dispatch = useDispatch();

  const onChangePredictionDepth = (predictionDepth: number) => {
    const conf = { ...quickSelectConfig, predictionDepth };
    dispatch(updateUserSettingAction("quickSelect", conf));
  };

  const closeControls = () => {
    dispatch(showQuickSelectSettingsAction(false));
  };

  return (
    <div>
      <div style={{ position: "absolute", right: 4, top: 4 }}>
        <FastTooltip
          placement="right-start"
          dynamicRenderer={() => (
            <div style={{ maxWidth: 400 }}>
              <p>
                The AI-based Quick Select feature can be used by clicking on a cell or by drawing a
                rectangle around a cell. By configuring the prediction depth, multiple sections can
                be segmented at once.
              </p>
              <p>
                Hint: If the predicted selection is too big, zoom in a bit further and try again.
              </p>
            </div>
          )}
        >
          <QuestionCircleOutlined />
        </FastTooltip>
      </div>
      <NumberSliderSetting
        label="Prediction Depth"
        min={1}
        value={quickSelectConfig.predictionDepth || 1}
        max={MAX_DEPTH_FOR_SAM}
        step={1}
        onChange={onChangePredictionDepth}
        defaultValue={defaultState.userConfiguration.quickSelect.predictionDepth}
      />
      <Shortcut supportInputElements keys="escape" onTrigger={closeControls} />
      <Shortcut supportInputElements keys="enter" onTrigger={closeControls} />
    </div>
  );
}
export function HeuristicQuickSelectControls() {
  const quickSelectConfig = useWkSelector((state) => state.userConfiguration.quickSelect);
  const isQuickSelectActive = useWkSelector(
    (state) => state.uiInformation.quickSelectState === "active",
  );

  const dispatch = useDispatch();

  const onResetValues = () => {
    const { segmentMode, threshold, closeValue, erodeValue, dilateValue, ...rest } =
      defaultState.userConfiguration.quickSelect;
    dispatch(
      updateUserSettingAction("quickSelect", {
        ...rest,
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
        defaultValue={defaultState.userConfiguration.quickSelect.threshold}
      />
      <NumberSliderSetting
        label="Close [vx]"
        min={0}
        value={quickSelectConfig.closeValue}
        max={10}
        step={1}
        onChange={onChangeCloseValue}
        defaultValue={defaultState.userConfiguration.quickSelect.closeValue}
      />
      <NumberSliderSetting
        label="Erode [vx]"
        min={0}
        value={quickSelectConfig.erodeValue}
        max={10}
        step={1}
        onChange={onChangeErodeValue}
        defaultValue={defaultState.userConfiguration.quickSelect.erodeValue}
      />
      <NumberSliderSetting
        label="Dilate [vx]"
        min={0}
        value={quickSelectConfig.dilateValue}
        max={10}
        step={1}
        onChange={onChangeDilateValue}
        defaultValue={defaultState.userConfiguration.quickSelect.dilateValue}
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
