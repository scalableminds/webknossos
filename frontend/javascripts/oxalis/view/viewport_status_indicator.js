// @flow

import * as React from "react";

import { Icon, Tooltip } from "antd";
import { getUnrenderableLayersForCurrentZoom } from "oxalis/model/accessors/dataset_accessor";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import { usePolledState } from "libs/react_helpers";

const { useState } = React;

export default function ViewportStatusIndicator() {
  const [unrenderableLayerNames, setUnrenderableLayerNames] = useState([]);
  const [renderMissingDataBlack, setRenderMissingDataBlack] = useState(true);
  const [currentResolution, setCurrentResolution] = useState([1, 1, 1]);

  usePolledState(state => {
    const newMissingLayersNames = getUnrenderableLayersForCurrentZoom(state);
    setUnrenderableLayerNames(
      newMissingLayersNames.map(layer =>
        layer.category === "segmentation" ? "Segmentation" : layer.name,
      ),
    );

    setRenderMissingDataBlack(state.datasetConfiguration.renderMissingDataBlack);

    setCurrentResolution(getCurrentResolution(state));
  });

  if (unrenderableLayerNames.length === 0) {
    return null;
  }
  const pluralS = unrenderableLayerNames.length > 1 ? "s" : "";
  const dontVerb = unrenderableLayerNames.length > 1 ? "don't" : "doesn't";

  const renderMissingDataBlackHint = renderMissingDataBlack
    ? " Also consider disabling the option “Render Missing Data Black”."
    : null;

  return (
    <Tooltip
      title={
        <div>
          The layer{pluralS} {unrenderableLayerNames.map(name => `"${name}"`).join(", ")} {dontVerb}{" "}
          exist in the current resolution {currentResolution.join("-")}. Adjust the zoom level to
          change the active resolution.{renderMissingDataBlackHint}
        </div>
      }
    >
      <div style={{ position: "absolute", bottom: "1%", left: "1%", color: "white" }}>
        <Icon
          type="warning"
          style={{ fontSize: 16, background: "rgba(0, 0, 0, .3)", padding: 4, borderRadius: 2 }}
        />
      </div>
    </Tooltip>
  );
}
