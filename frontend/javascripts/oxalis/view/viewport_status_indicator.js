// @flow

import * as React from "react";
import _ from "lodash";

import { WarningOutlined } from "@ant-design/icons";

import { Tooltip } from "antd";
import {
  getUnrenderableLayerInfosForCurrentZoom,
  type SmallerOrHigherInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { usePolledState } from "libs/react_helpers";

const { useState } = React;

type UnrenderableLayerNamesInfo = {
  layerName: string,
  smallerOrHigherInfo: SmallerOrHigherInfo,
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

  usePolledState(state => {
    const newMissingLayersWithInfos = getUnrenderableLayerInfosForCurrentZoom(state);
    const newAdjustedMissingLayersNamesWithInfos: Array<UnrenderableLayerNamesInfo> = newMissingLayersWithInfos.map(
      ({ layer, smallerOrHigherInfo }) =>
        layer.category === "segmentation"
          ? { layerName: "Segmentation", smallerOrHigherInfo }
          : { layerName: layer.name, smallerOrHigherInfo },
    );
    if (!_.isEqual(unrenderableLayerNamesWithInfo, newAdjustedMissingLayersNamesWithInfos)) {
      setUnrenderableLayerNamesWithInfo(newAdjustedMissingLayersNamesWithInfos);
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
    .filter(message => message != null)
    .join(" ");

  return (
    <Tooltip title={<div>{sentencesString}</div>}>
      <div style={{ position: "absolute", bottom: "1%", left: "1%", color: "white" }}>
        <WarningOutlined
          style={{ fontSize: 16, background: "rgba(0, 0, 0, .3)", padding: 4, borderRadius: 2 }}
        />
      </div>
    </Tooltip>
  );
}
