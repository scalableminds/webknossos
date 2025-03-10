import { WarningOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { usePolledState } from "libs/react_helpers";
import _ from "lodash";
import { getUnrenderableLayerInfosForCurrentZoom } from "oxalis/model/accessors/flycam_accessor";
import type { SmallerOrHigherInfo } from "oxalis/model/helpers/mag_info";
import * as React from "react";

const { useState } = React;
type UnrenderableLayerNamesInfo = {
  layerName: string;
  smallerOrHigherInfo: SmallerOrHigherInfo;
};

function getOptionalZoomMessage(
  directionString: string,
  unrenderableLayersWithInfo: Array<UnrenderableLayerNamesInfo>,
) {
  const renderableLayerNamesWithOtherZoomstep = unrenderableLayersWithInfo
    .filter(({ smallerOrHigherInfo: { higher, smaller } }) =>
      directionString === "in" ? smaller : higher,
    )
    .map(({ layerName }) => layerName);

  if (renderableLayerNamesWithOtherZoomstep.length === 0) {
    return null;
  }

  const pluralS = renderableLayerNamesWithOtherZoomstep.length > 1 ? "s" : "";
  return `Zoom ${directionString} to see layer${pluralS} ${renderableLayerNamesWithOtherZoomstep.join(
    ", ",
  )}.`;
}

export default function ViewportStatusIndicator() {
  const [unrenderableLayerNamesWithInfo, setUnrenderableLayerNamesWithInfo] = useState([]);
  const [renderMissingDataBlack, setRenderMissingDataBlack] = useState(true);
  usePolledState((state) => {
    const newUnrenderableLayersWithInfos = getUnrenderableLayerInfosForCurrentZoom(state);
    const newUnrenderableLayersNamesWithInfos: Array<UnrenderableLayerNamesInfo> =
      newUnrenderableLayersWithInfos.map(({ layer, smallerOrHigherInfo }) =>
        layer.category === "segmentation"
          ? {
              layerName: "Segmentation",
              smallerOrHigherInfo,
            }
          : {
              layerName: layer.name,
              smallerOrHigherInfo,
            },
      );

    if (!_.isEqual(unrenderableLayerNamesWithInfo, newUnrenderableLayersNamesWithInfos)) {
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'UnrenderableLayerNamesInfo[]' is... Remove this comment to see the full error message
      setUnrenderableLayerNamesWithInfo(newUnrenderableLayersNamesWithInfos);
    }

    setRenderMissingDataBlack(state.datasetConfiguration.renderMissingDataBlack);
  });

  if (unrenderableLayerNamesWithInfo.length === 0) {
    return null;
  }

  const zoomInMessage = getOptionalZoomMessage("in", unrenderableLayerNamesWithInfo);
  const zoomOutMessage = getOptionalZoomMessage("out", unrenderableLayerNamesWithInfo);
  const missingDataHint = renderMissingDataBlack
    ? " Also consider disabling the option “Render Missing Data Black”."
    : null;
  const sentencesString = [zoomInMessage, zoomOutMessage, missingDataHint]
    .filter((message) => message != null)
    .join(" ");
  return (
    <div
      style={{
        position: "absolute",
        bottom: "1%",
        left: "1%",
        color: "white",
      }}
    >
      <FastTooltip title={sentencesString}>
        <WarningOutlined
          style={{
            fontSize: 16,
            background: "rgba(0, 0, 0, .3)",
            padding: 4,
            borderRadius: 2,
          }}
        />
      </FastTooltip>
    </div>
  );
}
