// @flow
import { Button } from "antd";
import * as React from "react";

import api from "oxalis/api/internal_api";

const ButtonGroup = Button.Group;

function TDViewControls() {
  return (
    <ButtonGroup id="TDViewControls">
      <Button size="small" onClick={api.tracing.rotate3DViewToDiagonal}>
        3D
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToXY}>
        <span className="colored-dot" />XY
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToYZ}>
        <span className="colored-dot" />YZ
      </Button>
      <Button size="small" onClick={api.tracing.rotate3DViewToXZ}>
        <span className="colored-dot" />XZ
      </Button>
    </ButtonGroup>
  );
}

export default TDViewControls;
