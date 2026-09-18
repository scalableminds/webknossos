import { QuestionCircleOutlined } from "@ant-design/icons";
import { Radio, type RadioChangeEvent } from "antd";
import FastTooltip from "components/fast_tooltip";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Shortcut from "libs/shortcut_component";
import { useDispatch } from "react-redux";
import getSceneController from "viewer/controller/scene_controller_provider";
import defaultState from "viewer/default_state";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  clearQuickSelectExemplarBoxesAction,
  showQuickSelectSettingsAction,
} from "viewer/model/actions/ui_actions";
import {
  cancelQuickSelectAction,
  computeQuickSelectForExemplarsAction,
  confirmQuickSelectAction,
  fineTuneQuickSelectAction,
} from "viewer/model/actions/volumetracing_actions";
import ButtonComponent from "../components/button_component";
import NumberSliderSetting from "../left_border_tabs/components/number_slider_setting";
import SwitchSetting from "../left_border_tabs/components/switch_setting";

// The maximum depth of 50 also needs to be adapted in the back-end
// (at the time of writing, in segmentAnythingMask in DatasetController.scala).
const MAX_DEPTH_FOR_SAM = 50;

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

function AiQuickSelectControls() {
  const quickSelectConfig = useWkSelector((state) => state.userConfiguration.quickSelect);
  const exemplarBoxes = useWkSelector((state) => state.uiInformation.quickSelectExemplarBoxes);
  const isQuickSelectActive = useWkSelector(
    (state) => state.uiInformation.quickSelectState === "active",
  );
  const areExemplarsAvailable = Boolean(features().segmentAnythingExemplarsEnabled);
  const useExemplars = Boolean(quickSelectConfig.useExemplars) && areExemplarsAvailable;

  const dispatch = useDispatch();

  const onChangePredictionDepth = (predictionDepth: number) => {
    const conf = { ...quickSelectConfig, predictionDepth };
    dispatch(updateUserSettingAction("quickSelect", conf));
  };

  const onToggleExemplars = (value: boolean) => {
    dispatch(updateUserSettingAction("quickSelect", { ...quickSelectConfig, useExemplars: value }));
    dispatch(clearQuickSelectExemplarBoxesAction());
    getSceneController().quickSelectGeometry.setExemplarBoxes([]);
  };

  const onClearExemplars = () => {
    dispatch(clearQuickSelectExemplarBoxesAction());
    getSceneController().quickSelectGeometry.setExemplarBoxes([]);
  };

  const onRunExemplars = () => {
    dispatch(
      computeQuickSelectForExemplarsAction(exemplarBoxes, getSceneController().quickSelectGeometry),
    );
    dispatch(showQuickSelectSettingsAction(false));
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
                With "Find Similar Instances", you instead draw boxes around a few examples and the
                model detects every instance resembling them, creating one segment per instance (at
                most 16). This is considerably slower than a single prompt.
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
      {areExemplarsAvailable ? (
        <SwitchSetting
          label="Find Similar Instances"
          value={useExemplars}
          onChange={onToggleExemplars}
          tooltipText="Draw a few example boxes and let the model find every instance that looks like them. Returns up to 16 segments at once."
        />
      ) : null}
      <NumberSliderSetting
        label="Prediction Depth"
        min={1}
        value={quickSelectConfig.predictionDepth || 1}
        max={MAX_DEPTH_FOR_SAM}
        step={1}
        onChange={onChangePredictionDepth}
        defaultValue={defaultState.userConfiguration.quickSelect.predictionDepth}
      />
      {useExemplars ? (
        <div style={{ marginTop: "0.5rem" }}>
          <div style={{ marginBottom: "0.5rem" }}>
            {exemplarBoxes.length === 0
              ? "Draw one or more boxes around example instances."
              : `${exemplarBoxes.length} exemplar box${exemplarBoxes.length === 1 ? "" : "es"} drawn.`}
          </div>
          {/* Running the detector on every section is far slower than an interactive prompt, so
              say so before the user starts a deep prediction rather than after. */}
          {(quickSelectConfig.predictionDepth || 1) > 5 ? (
            <div style={{ marginBottom: "0.5rem", opacity: 0.65 }}>
              Detecting instances across {quickSelectConfig.predictionDepth} sections can take
              several minutes.
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem" }}>
            <ButtonComponent
              size="small"
              onClick={onClearExemplars}
              disabled={exemplarBoxes.length === 0}
              title="Discard the drawn exemplar boxes"
            >
              Clear
            </ButtonComponent>
            <ButtonComponent
              size="small"
              type="primary"
              onClick={onRunExemplars}
              disabled={exemplarBoxes.length === 0 || isQuickSelectActive}
              title="Find all instances resembling the drawn boxes"
            >
              Find Instances
            </ButtonComponent>
          </div>
        </div>
      ) : null}
      <Shortcut supportInputElements keys="escape" onTrigger={closeControls} />
      <Shortcut supportInputElements keys="enter" onTrigger={closeControls} />
    </div>
  );
}
function HeuristicQuickSelectControls() {
  const quickSelectConfig = useWkSelector((state) => state.userConfiguration.quickSelect);
  const isQuickSelectActive = useWkSelector(
    (state) => state.uiInformation.quickSelectState === "active",
  );

  const dispatch = useDispatch();
  const isAISelectAvailable = features().segmentAnythingEnabled;
  const isQuickSelectHeuristic = quickSelectConfig.useHeuristic || !isAISelectAvailable;
  const quickSelectTooltipText = isAISelectAvailable
    ? isQuickSelectHeuristic
      ? "The quick select tool is now working without AI. Activate AI for better results."
      : "The quick select tool is now working with AI."
    : "The quick select tool with AI is only available on webknossos.org";
  const toggleQuickSelectStrategy = () => {
    dispatch(
      updateUserSettingAction("quickSelect", {
        ...quickSelectConfig,
        useHeuristic: !quickSelectConfig.useHeuristic,
      }),
    );
  };

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
        value={!isQuickSelectHeuristic}
        onChange={toggleQuickSelectStrategy}
        disabled={!isAISelectAvailable}
        tooltipText={quickSelectTooltipText}
        label="AI Mode"
      ></SwitchSetting>
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
