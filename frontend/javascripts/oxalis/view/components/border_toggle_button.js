// @flow
import * as React from "react";
import { Button, Tooltip } from "antd";
import { connect } from "react-redux";
import type { OxalisState, BorderOpenStatus } from "oxalis/store";

type OwnProps = {|
  onClick: () => void,
  side: "left" | "right",
  small?: boolean,
  style?: Object,
|};
type StateProps = {|
  borderOpenStatus: BorderOpenStatus,
|};
type Props = {| ...OwnProps, ...StateProps |};

function BorderToggleButton(props: Props) {
  const { onClick, side, small, style, borderOpenStatus } = props;
  const additionalClass = small === true ? "small-border-icon" : "";
  const mirrorIconStyle = { transform: "scale(-1, 1)" };
  const placement = side === "left" ? "right" : "left";
  const iconClass = borderOpenStatus[side] === true ? "fa-outdent" : "fa-indent";

  return (
    <Tooltip title={`Toggle ${side} sidebar`} placement={placement}>
      <Button
        className={`${side}-border-button ${additionalClass}`}
        onClick={onClick}
        size={small === true ? "small" : "default"}
        style={style != null ? style : null}
      >
        <i
          className={`fas ${iconClass} center-item-using-flex`}
          style={side === "right" ? mirrorIconStyle : null}
        />
      </Button>
    </Tooltip>
  );
}

function mapStateToProps(state: OxalisState) {
  return { borderOpenStatus: state.uiInformation.borderOpenStatus };
}
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(BorderToggleButton);
