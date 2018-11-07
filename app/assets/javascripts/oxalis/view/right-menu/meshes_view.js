// @flow

import { Checkbox } from "antd";
import { connect } from "react-redux";
import React from "react";

import type { MeshMetaData } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";

type OwnProps = {||};
type StateProps = {|
  meshes: Array<MeshMetaData>,
|};
type Props = { ...OwnProps, ...StateProps };

class MeshesView extends React.Component<Props> {
  render() {
    return (
      <div id="volume-mapping-info" className="info-tab-content">
        Meshes
        <ul>
          {this.props.meshes.map(mesh => (
            <li key={mesh.id}>
              <Checkbox
                checked={mesh.isVisible}
                onChange={(event: SyntheticInputEvent<>) => {
                  event.target.checked;
                }}
              >
                {mesh.description}
              </Checkbox>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  meshes: state.tracing != null ? state.tracing.meshes : [],
});

export default connect(mapStateToProps)(MeshesView);
