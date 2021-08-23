// @flow

import * as React from "react";
import _ from "lodash";

import { WarningOutlined } from "@ant-design/icons";

import { Tooltip } from "antd";
import { getUnrenderableLayersForCurrentZoom } from "oxalis/model/accessors/dataset_accessor";
import { usePolledState } from "libs/react_helpers";

const { useState } = React;

export default function ViewportStatusIndicator() {
  const [unrenderableLayersWithInfo, setUnrenderableLayersWithInfo] = useState([]);
  const [renderMissingDataBlack, setRenderMissingDataBlack] = useState(true);

  usePolledState(state => {
    const newMissingLayersNames = getUnrenderableLayersForCurrentZoom(state);
    const newAdjustedMissingLayersNames = newMissingLayersNames.map(
      ([layer, smallerOrHigherInfo]) =>
        layer.category === "segmentation"
          ? ["Segmentation", smallerOrHigherInfo]
          : [layer.name, smallerOrHigherInfo],
    );
    if (!_.isEqual(unrenderableLayersWithInfo, newAdjustedMissingLayersNames)) {
      setUnrenderableLayersWithInfo(newAdjustedMissingLayersNames);
    }

    setRenderMissingDataBlack(state.datasetConfiguration.renderMissingDataBlack);
  });
  console.log("unrenderableLayersWithInfo", unrenderableLayersWithInfo);
  if (unrenderableLayersWithInfo.length === 0) {
    return null;
  }
  const unrenderableLayerNamesWithSmallerZoomstep = unrenderableLayersWithInfo
    .filter(([, { smaller }]) => smaller)
    .map(([layerName]) => layerName);
  const pluralSForSmallerZoomstep = unrenderableLayerNamesWithSmallerZoomstep.length > 1 ? "s" : "";
  const unrenderableLayerNamesWithHigherZoomstep = unrenderableLayersWithInfo
    .filter(([, { higher }]) => higher)
    .map(([layerName]) => layerName);
  const pluralSForHigherZoomstep = unrenderableLayerNamesWithHigherZoomstep.length > 1 ? "s" : "";
  console.log(
    "unrenderableLayerNamesWithSmallerZoomstep",
    unrenderableLayerNamesWithSmallerZoomstep,
  );
  console.log("unrenderableLayerNamesWithHigherZoomstep", unrenderableLayerNamesWithHigherZoomstep);

  const renderMissingDataBlackHint = renderMissingDataBlack
    ? " Also consider disabling the option “Render Missing Data Black”."
    : null;

  return (
    <Tooltip
      title={
        <div>
          {unrenderableLayerNamesWithSmallerZoomstep.length > 0
            ? `Zoom in to see layer${pluralSForSmallerZoomstep} ${unrenderableLayerNamesWithSmallerZoomstep.join(
                ", ",
              )}${
                unrenderableLayerNamesWithHigherZoomstep.length > 0 || renderMissingDataBlackHint
                  ? " "
                  : ""
              }`
            : null}
          {unrenderableLayerNamesWithHigherZoomstep.length > 0
            ? `Zoom out to see layer${pluralSForHigherZoomstep} ${unrenderableLayerNamesWithHigherZoomstep.join(
                ", ",
              )}${renderMissingDataBlackHint ? " " : ""}`
            : null}
          {renderMissingDataBlackHint}
        </div>
      }
    >
      <div style={{ position: "absolute", bottom: "1%", left: "1%", color: "white" }}>
        <WarningOutlined
          style={{ fontSize: 16, background: "rgba(0, 0, 0, .3)", padding: 4, borderRadius: 2 }}
        />
      </div>
    </Tooltip>
  );
}
