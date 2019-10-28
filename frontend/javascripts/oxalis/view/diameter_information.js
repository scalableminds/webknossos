// @flow

import { connect } from "react-redux";
import * as React from "react";
import { getActiveNodeDirectly } from "oxalis/model/accessors/skeletontracing_accessor";
import type { OxalisState, DiameterProperties } from "oxalis/store";

type OwnProps = {||};

type StateProps = {|
  diameterProperties: ?DiameterProperties,
|};

type Props = {|
  ...OwnProps,
  ...StateProps,
|};

function DiameterInformation({ diameterProperties }: Props) {
  if (!diameterProperties) {
    return null;
  }
  const { scaledXRadius, scaledYRadius, rotationAngle } = diameterProperties;
  const majorAxis = Math.max(scaledXRadius, scaledYRadius).toFixed(2);
  const minorAxis = Math.min(scaledXRadius, scaledYRadius).toFixed(2);

  return (
    <table className="diameter-information">
      <tbody>
        <tr>
          <td>major axis</td>
          <td> {majorAxis} nm</td>
        </tr>
        <tr>
          <td>minor axis</td>
          <td> {minorAxis} nm</td>
        </tr>
        <tr>
          <td>rotation</td>
          <td> {rotationAngle}° </td>
        </tr>
      </tbody>
    </table>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => {
  const activeNode = getActiveNodeDirectly(state);
  return { diameterProperties: activeNode ? activeNode.diameterProperties : null };
};

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(DiameterInformation);
