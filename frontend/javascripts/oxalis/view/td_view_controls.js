// @flow
import { Button, Tooltip } from "antd";
import * as React from "react";
import { connect } from "react-redux";
import type { OxalisState, VolumeTracing } from "oxalis/store";

import api from "oxalis/api/internal_api";

const ButtonGroup = Button.Group;

type Props = {|
  renderIsosurfaces: boolean,
  isRefreshingIsosurfaces: boolean,
  volumeTracing: ?VolumeTracing,
|};

function TDViewControls({ renderIsosurfaces, isRefreshingIsosurfaces, volumeTracing }: Props) {
  let refreshIsosurfaceTooltip = "Load Isosurface of centered cell from segmentation layer.";
  if (volumeTracing != null) {
    if (volumeTracing.fallbackLayer != null) {
      refreshIsosurfaceTooltip = "Load Isosurface of centered cell from fallback annotation layer";
    } else {
      refreshIsosurfaceTooltip = "Reload annotated Isosurfaces to newest version.";
    }
  }
  return (
    <ButtonGroup id="TDViewControls">
      <Button size="small" onClick={api.tracing.rotate3DViewToDiagonal}>
        3D
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToXY}>
        <span className="colored-dot" />
        XY
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToYZ}>
        <span className="colored-dot" />
        YZ
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToXZ}>
        <span className="colored-dot" />
        XZ
      </Button>
      {renderIsosurfaces ? (
        <Tooltip title={refreshIsosurfaceTooltip}>
          <Button
            size="small"
            icon="reload"
            loading={isRefreshingIsosurfaces}
            onClick={api.data.refreshIsosurfaces}
          />
        </Tooltip>
      ) : null}
    </ButtonGroup>
  );
}

export function mapStateToProps(state: OxalisState): Props {
  return {
    renderIsosurfaces: state.datasetConfiguration.renderIsosurfaces,
    isRefreshingIsosurfaces: state.uiInformation.isRefreshingIsosurfaces,
    volumeTracing: state.tracing.volume,
  };
}

export default connect<Props, {}, _, _, _, _>(mapStateToProps)(TDViewControls);
