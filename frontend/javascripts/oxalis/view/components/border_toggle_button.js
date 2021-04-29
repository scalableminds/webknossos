// @flow
import * as React from "react";
import { Button, Tooltip } from "antd";
import { connect } from "react-redux";
import type { OxalisState, BorderOpenStatus } from "oxalis/store";
import { document } from "libs/window";

type OwnProps = {|
  onClick: () => void,
  side: "left" | "right",
  inFooter?: boolean,
|};
type StateProps = {|
  borderOpenStatus: BorderOpenStatus,
|};
type Props = {| ...OwnProps, ...StateProps |};

function useIsDarkMode() {
  const style = getComputedStyle(document.body);
  return parseInt(style.getPropertyValue("--is-dark-mode")) === 1;
}

function BorderToggleButton(props: Props) {
  const isDarkMode = useIsDarkMode();
  const { onClick, side, borderOpenStatus, inFooter } = props;
  const placement = side === "left" ? "right" : "left";
  const iconKind = borderOpenStatus[side] ? "hide" : "show";
  const tooltipTitle = `${borderOpenStatus[side] === false ? "Open" : "Hide"} ${side} sidebar`;
  const className = `${side}-border-button no-hover-highlighting ${
    inFooter === true ? "footer-button" : "flexlayout__tab_toolbar_button"
  }`;
  const imageSrc = `/assets/images/icon-sidebar-${iconKind}-${side}-${
    inFooter || isDarkMode ? "dark" : "bright"
  }.svg`;

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
        <img className="center-item-using-flex" src={imageSrc} alt="Border Toggle Button" />
      </Button>
    </Tooltip>
  );
}

function mapStateToProps(state: OxalisState) {
  return { borderOpenStatus: state.uiInformation.borderOpenStatus };
}
export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(BorderToggleButton);
