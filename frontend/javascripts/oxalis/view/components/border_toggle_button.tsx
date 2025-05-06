import { Button } from "antd";
import FastTooltip from "components/fast_tooltip";
import { V2 } from "libs/mjs";
import type { BorderOpenStatus, WebknossosState } from "oxalis/store";
import * as React from "react";
import { connect } from "react-redux";
type OwnProps = {
  onClick: () => void;
  side: "left" | "right";
  inFooter?: boolean;
};
type StateProps = {
  borderOpenStatus: BorderOpenStatus;
};
type Props = OwnProps & StateProps;
const DRAG_THRESHOLD = 5;

const TOOLTIP_STYLE = { height: 24 };

function BorderToggleButton(props: Props) {
  const { onClick, side, borderOpenStatus, inFooter } = props;
  const placement = side === "left" ? "top-end" : "top-start";
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
    <FastTooltip title={tooltipTitle} placement={placement} style={TOOLTIP_STYLE}>
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
        onClick={(event) => {
          if (event != null) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'EventTarge... Remove this comment to see the full error message
            event.target.blur(); // this will only blur the the wrapped icon <div> element
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'EventTarge... Remove this comment to see the full error message
            event.target.parentElement.blur(); // this will only blur the <button> element
          }

          onClick();
        }}
        onMouseDown={(evt) => {
          evt.stopPropagation();
        }}
        onTouchStart={(evt) => {
          evt.preventDefault();
          setLastTouchPosition([evt.touches[0].pageX, evt.touches[0].pageY]);
        }}
        onTouchEnd={(evt) => {
          const currentTouchPos = [evt.changedTouches[0].pageX, evt.changedTouches[0].pageY];
          const delta = V2.length(V2.sub(lastTouchPosition, currentTouchPos));

          if (delta < DRAG_THRESHOLD) {
            onClick();
          }
        }}
      >
        <div className={imageClass} />
      </Button>
    </FastTooltip>
  );
}

function mapStateToProps(state: WebknossosState) {
  return {
    borderOpenStatus: state.uiInformation.borderOpenStatus,
  };
}

const connector = connect(mapStateToProps);
export default connector(BorderToggleButton);
