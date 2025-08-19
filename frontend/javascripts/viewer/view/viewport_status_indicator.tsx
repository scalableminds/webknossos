import { WarningOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { usePolledState } from "libs/react_helpers";
import _ from "lodash";
import * as React from "react";
import type { APISegmentationLayer } from "types/api_types";
import { getUnrenderableLayerInfosForCurrentZoom } from "viewer/model/accessors/flycam_accessor";
import type { SmallerOrHigherInfo } from "viewer/model/helpers/mag_info";

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
    const annotationLayers = state.annotation.annotationLayers;
    const getSegmentationLayerName = (
      layer: APISegmentationLayer,
      tracingId: string | undefined,
    ) => {
      if (layer.name !== tracingId) return layer.name;
      const annotationLayer = annotationLayers.find(
        (annotationLayer) => annotationLayer.tracingId === layer.tracingId,
      );
      if (annotationLayer) {
        return annotationLayer.name;
      }
      return layer.name;
    };
    console.log(newUnrenderableLayersWithInfos, annotationLayers);
    const newUnrenderableLayersNamesWithInfos: Array<UnrenderableLayerNamesInfo> =
      newUnrenderableLayersWithInfos.map(({ layer, smallerOrHigherInfo }) =>
        layer.category === "segmentation"
          ? {
              layerName: getSegmentationLayerName(layer, layer.tracingId),
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
