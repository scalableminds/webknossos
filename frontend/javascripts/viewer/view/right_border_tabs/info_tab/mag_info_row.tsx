import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { getMagnificationUnion } from "viewer/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "viewer/model/accessors/flycam_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import { Store } from "viewer/singletons";
import { InfoTabRow } from "./info_tab_layout";

export function MagInfoRow() {
  const activeMagInfo = useWkSelector(getActiveMagInfo);
  const dataset = useWkSelector((state) => state.dataset);
  const { representativeMag, isActiveMagGlobal, activeMagOfEnabledLayers } = activeMagInfo;

  const renderMagsTooltip = () => {
    // The annotation is read lazily when the tooltip is actually rendered
    // (i.e., on hover) so that this row doesn't need to subscribe to (and
    // re-render on) every annotation mutation.
    const { annotation } = Store.getState();
    const magUnion = getMagnificationUnion(dataset);
    return (
      <div style={{ width: 200 }}>
        Rendered magnification per layer:
        <ul>
          {Object.entries(activeMagOfEnabledLayers).map(([layerName, mag]) => {
            const readableName = getReadableNameForLayerName(dataset, annotation, layerName);

            return (
              <li key={layerName}>
                {readableName}: {mag ? mag.join("-") : "none"}
              </li>
            );
          })}
        </ul>
        Available magnifications:
        <ul>
          {magUnion.map((mags) => (
            <li key={mags[0].join()}>{mags.map((mag) => mag.join("-")).join(", ")}</li>
          ))}
        </ul>
        {messages["dataset.mag_explanation"]}
      </div>
    );
  };

  if (representativeMag == null) {
    return null;
  }

  return (
    <InfoTabRow label="Current magnification" isShortValue tooltipRenderer={renderMagsTooltip}>
      <span>
        {representativeMag.join("-")}
        {isActiveMagGlobal ? "" : "*"}
      </span>
    </InfoTabRow>
  );
}
