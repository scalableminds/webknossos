import Icon from "@ant-design/icons";
import IconDownsampling from "@images/icons/icon-downsampling.svg?react";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { getMagnificationUnion } from "viewer/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "viewer/model/accessors/flycam_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import { Store } from "viewer/singletons";

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

  return representativeMag != null ? (
    <FastTooltip dynamicRenderer={renderMagsTooltip} placement="left" wrapper="tr">
      <td
        style={{
          paddingRight: 4,
          paddingTop: 8,
        }}
      >
        <Icon component={IconDownsampling} className="info-tab-icon" aria-label="Magnification" />
      </td>
      <td
        style={{
          paddingRight: 4,
          paddingTop: 8,
        }}
      >
        {representativeMag.join("-")}
        {isActiveMagGlobal ? "" : "*"}{" "}
      </td>
    </FastTooltip>
  ) : null;
}
