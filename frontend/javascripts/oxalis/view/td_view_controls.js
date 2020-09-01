// @flow
import { Button, Tooltip } from "antd";
import * as React from "react";
import { connect } from "react-redux";
import type { OxalisState } from "oxalis/store";

import api from "oxalis/api/internal_api";

const ButtonGroup = Button.Group;

type Props = {|
  renderIsosurfaces: boolean,
  isRefreshingIsosurfaces: boolean,
|};

function TDViewControls({ renderIsosurfaces, isRefreshingIsosurfaces }: Props) {
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
        <Tooltip title="Reload Isosurfaces to newest version.">
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
  };
}

export default connect<Props, {}, _, _, _, _>(mapStateToProps)(TDViewControls);
