// @flow
import * as React from "react";
import { Button, Tooltip } from "antd";
import { connect } from "react-redux";
import type { OxalisState, BorderOpenStatus } from "oxalis/store";

type OwnProps = {|
  onClick: () => void,
  side: "left" | "right",
  inFooter?: boolean,
|};
type StateProps = {|
  borderOpenStatus: BorderOpenStatus,
|};
type Props = {| ...OwnProps, ...StateProps |};

function BorderToggleButton(props: Props) {
  const { onClick, side, borderOpenStatus, inFooter } = props;
  const placement = side === "left" ? "right" : "left";
  const iconKind = borderOpenStatus[side] ? "hide" : "show";
  const tooltipTitle = `${borderOpenStatus[side] ? "Hide" : "Open"} ${side} sidebar (${
    side === "left" ? "K" : "L"
  })`;
  const className = `${side}-border-button no-hover-highlighting ${
    inFooter === true ? "footer-button" : "flexlayout__tab_toolbar_button"
  }`;
  const imageClass = `center-item-using-flex icon-sidebar-toggle icon-sidebar-${iconKind}-${side}-${
    inFooter ? "dark" : "bright"
  }`;

  return (
    <Tooltip title={tooltipTitle} placement={placement}>
      <Button
        className={className}
        onClick={event => {
          if (event != null) {
            event.target.blur();
          }
          onClick();
        }}
        size="small"
        onMouseDown={evt => evt.stopPropagation()}
        onTouchStart={evt => evt.preventDefault()}
      >
        <div className={imageClass} />
      </Button>
    </Tooltip>
  );
}

function mapStateToProps(state: OxalisState) {
  return { borderOpenStatus: state.uiInformation.borderOpenStatus };
}
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(BorderToggleButton);
