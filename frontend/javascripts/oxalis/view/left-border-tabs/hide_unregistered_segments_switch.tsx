import FastTooltip from "components/fast_tooltip";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import { getHideUnregisteredSegmentsForLayer } from "oxalis/model/accessors/volumetracing_accessor";
import { setHideUnregisteredSegmentsAction } from "oxalis/model/actions/volumetracing_actions";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
import { SwitchSetting } from "oxalis/view/components/setting_input_views";
import { useSelector } from "react-redux";

export function HideUnregisteredSegmentsSwitch({ layerName }: { layerName: string }) {
  const activeTool = useSelector((state: OxalisState) => state.uiInformation.activeTool);

  const isProofreadingMode = activeTool === AnnotationTool.PROOFREAD;
  const selectiveVisibilityInProofreading = useSelector(
    (state: OxalisState) => state.userConfiguration.selectiveVisibilityInProofreading,
  );
  const isHideUnregisteredSegmentsDisabled =
    isProofreadingMode && selectiveVisibilityInProofreading;
  const hideUnregisteredSegments = useSelector((state: OxalisState) =>
    getHideUnregisteredSegmentsForLayer(state, layerName),
  );

  return (
    <FastTooltip
      title={
        isHideUnregisteredSegmentsDisabled
          ? "This behavior is overridden by the enabled 'selective segment visibility' feature in the toolbar that belongs to the proofreading tool."
          : "When enabled, segments that were not added to the segment list are hidden by default."
      }
    >
      <div
        style={{
          marginBottom: 6,
        }}
      >
        <SwitchSetting
          onChange={() => {
            Store.dispatch(setHideUnregisteredSegmentsAction(!hideUnregisteredSegments, layerName));
          }}
          value={hideUnregisteredSegments}
          label={"Hide unlisted segments"}
          disabled={isHideUnregisteredSegmentsDisabled}
        />
      </div>
    </FastTooltip>
  );
}
