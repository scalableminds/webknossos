// @flow
import * as React from "react";
import { Button, Tooltip, Icon } from "antd";
import { connect } from "react-redux";
import type { OxalisState, BorderOpenStatus } from "oxalis/store";

type OwnProps = {|
  onClick: () => void,
  side: "left" | "right",
  style?: Object,
  inFooter?: boolean,
|};
type StateProps = {|
  borderOpenStatus: BorderOpenStatus,
|};
type Props = {| ...OwnProps, ...StateProps |};

function BorderToggleButton(props: Props) {
  const { onClick, side, style, borderOpenStatus, inFooter } = props;
  const mirrorIconStyle = { transform: "scale(-1, 1)" };
  const placement = side === "left" ? "right" : "left";
  const iconStyle = borderOpenStatus[side] === false ? mirrorIconStyle : null;
  const tooltipTitle = `${borderOpenStatus[side] === false ? "Open" : "Hide"} ${side} sidebar`;
  const className = `${side}-border-button no-hover-highlighting ${
    inFooter === true ? "footer-button" : "flexlayout__tab_toolbar_button"
  }`;

  return (
    <Tooltip title={tooltipTitle} placement={placement} key={`${side}-border-toggle-button`}>
      <Button
        className={className}
        onClick={event => {
          if (event != null) {
            event.target.blur();
          }
          onClick();
        }}
        size="small"
        style={style}
        onMouseDown={evt => evt.stopPropagation()}
        onTouchStart={evt => evt.preventDefault()}
      >
        <Icon className="center-item-using-flex" style={iconStyle} type={`${side}-square`} />
      </Button>
    </Tooltip>
  );
}

function mapStateToProps(state: OxalisState) {
  return { borderOpenStatus: state.uiInformation.borderOpenStatus };
}
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(BorderToggleButton);
