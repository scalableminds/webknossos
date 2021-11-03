// @flow
import * as React from "react";
import { Button, Tooltip } from "antd";
import { connect } from "react-redux";
import type { OxalisState, BorderOpenStatus } from "oxalis/store";
import { V2 } from "libs/mjs";

type OwnProps = {|
  onClick: () => void,
  side: "left" | "right",
  inFooter?: boolean,
|};
type StateProps = {|
  borderOpenStatus: BorderOpenStatus,
|};
type Props = {| ...OwnProps, ...StateProps |};

const DRAG_THRESHOLD = 5;

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
  const [lastTouchPosition, setLastTouchPosition] = React.useState([0, 0]);

  return (
    <Tooltip title={tooltipTitle} placement={placement}>
      <Button
        className={className}
        size="small"
        /*
        Normally, a simple onClick handler would be enough for this button
        to support both desktops as mobile devices with touchscreens.
        However, since the button is placed in the FlexLayout's panels,
        its presence interferes with the existing mouse drag / touch drag
        behavior to move tabs around.
        For this reason, we have to call stopPropagation and preventDefault.
        Additionally, we need to detect whether the user has dragged a tab
        across screen (to move a tab). In that case, onTouchEnd does nothing.
        */
        onClick={event => {
          if (event != null) {
            event.target.blur();
          }
          onClick();
        }}
        onMouseDown={evt => {
          evt.stopPropagation();
        }}
        onTouchStart={evt => {
          evt.preventDefault();
          setLastTouchPosition([evt.touches[0].pageX, evt.touches[0].pageY]);
        }}
        onTouchEnd={evt => {
          const currentTouchPos = [evt.changedTouches[0].pageX, evt.changedTouches[0].pageY];

          const delta = V2.length(V2.sub(lastTouchPosition, currentTouchPos));
          if (delta < DRAG_THRESHOLD) {
            onClick();
          }
        }}
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
