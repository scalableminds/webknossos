// @flow

import * as React from "react";

import { Icon, Tooltip } from "antd";
import { getMissingLayersForCurrentZoom } from "oxalis/model/accessors/dataset_accessor";
import { usePolledState } from "libs/react_helpers";

const { useState } = React;

export default function ViewportStatusIndicator() {
  const [missingLayerNames, setMissingLayerNames] = useState([]);

  usePolledState(state => {
    const newMissingLayersNames = getMissingLayersForCurrentZoom(state);
    setMissingLayerNames(
      newMissingLayersNames.map(layer =>
        layer.category === "segmentation" ? "Segmentation" : layer.name,
      ),
    );
  });

  if (missingLayerNames.length === 0) {
    return null;
  }
  const pluralS = missingLayerNames.length > 1 ? "s" : "";
  const pronounAndVerb = missingLayerNames.length > 1 ? "they don't" : "it doesn't";

  return (
    <Tooltip
      title={
        <div>
          The layer{pluralS} {missingLayerNames.map(name => `"${name}"`).join(", ")} cannot be
          rendered because {pronounAndVerb} exist in the current magnification. Please adjust the
          zoom level to change the active magnification. Also consider disabling the option
          &ldquo;Render Missing Data Black&rdquo; if this is not already the case.
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
