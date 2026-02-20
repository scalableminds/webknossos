import { Button } from "antd";
import FastTooltip from "components/fast_tooltip";
import { V2 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { type MouseEventHandler, useCallback, useState } from "react";

type Props = {
  onClick: () => void;
  side: "left" | "right";
  inFooter?: boolean;
};

const DRAG_THRESHOLD = 5;
const TOOLTIP_STYLE = { height: 24 };

function BorderToggleButton({ onClick, side, inFooter }: Props) {
  const borderOpenStatus = useWkSelector((state) => state.uiInformation.borderOpenStatus);
  const [lastTouchPosition, setLastTouchPosition] = useState([0, 0]);

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

  const onClickHandler = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      if (event != null) {
        event.currentTarget.blur(); // this will only blur the the wrapped icon <div> element
        event.currentTarget.parentElement?.blur(); // this will only blur the <button> element
      }

      onClick();
    },
    [onClick],
  );

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
        onClick={onClickHandler}
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

export default BorderToggleButton;
