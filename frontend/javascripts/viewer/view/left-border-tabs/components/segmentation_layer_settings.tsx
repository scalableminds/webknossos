import { useWkSelector } from "libs/react_hooks";
import { settings } from "messages";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { defaultDatasetViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { updateDatasetSettingAction } from "viewer/model/actions/settings_actions";
import { NumberSliderSetting } from "viewer/view/components/setting_input_views";
import { HideUnregisteredSegmentsSwitch } from "../hide_unregistered_segments_switch";
import MappingSettingsView from "../mapping_settings_view";

export default function SegmentationLayerSettings({ layerName }: { layerName: string }) {
  const dispatch = useDispatch();
  const segmentationPatternOpacity = useWkSelector(
    (state) => state.datasetConfiguration.segmentationPatternOpacity,
  );

  const onChangeOpacity = useCallback(
    (value: number) => dispatch(updateDatasetSettingAction("segmentationPatternOpacity", value)),
    [dispatch],
  );

  return (
    <div>
      <NumberSliderSetting
        label={settings.segmentationPatternOpacity}
        min={0}
        max={100}
        step={1}
        value={segmentationPatternOpacity}
        onChange={onChangeOpacity}
        defaultValue={defaultDatasetViewConfiguration.segmentationPatternOpacity}
      />
      <HideUnregisteredSegmentsSwitch layerName={layerName} />
      <MappingSettingsView layerName={layerName} />
    </div>
  );
}
