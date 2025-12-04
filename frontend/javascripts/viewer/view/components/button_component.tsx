import { Button, type ButtonProps } from "antd";
import FastTooltip, { type FastTooltipPlacement } from "components/fast_tooltip";
import _ from "lodash";
import type React from "react";

type ButtonComponentProps = ButtonProps & {
  faIcon?: string;
  tooltipPlacement?: FastTooltipPlacement | undefined;
};
/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 */

function ButtonComponent(props: ButtonComponentProps) {
  const {
    children,
    faIcon,
    title,
    tooltipPlacement,
    onClick = _.noop,
    onTouchEnd,
    ...restProps
  } = props;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    onClick(e);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (onTouchEnd) {
      onTouchEnd(e);
    }
  };

  const iconEl = faIcon != null && !props.loading ? <i className={faIcon} /> : null;
  const button =
    // Differentiate via children != null, since antd uses a different styling for buttons
    // with a single icon child (.ant-btn-icon-only will be assigned)
    children != null ? (
      <Button {...restProps} onClick={handleClick} onTouchEnd={handleTouchEnd}>
        {iconEl}
        {children}
      </Button>
    ) : (
      <Button {...restProps} onClick={handleClick} onTouchEnd={handleTouchEnd}>
        {iconEl}
      </Button>
    );
  return title != null ? (
    <FastTooltip title={title} placement={tooltipPlacement}>
      {button}
    </FastTooltip>
  ) : (
    button
  );
}

export function ToggleButton(props: { active: boolean } & ButtonComponentProps) {
  const { active, ...restProps } = props;
  return <ButtonComponent type={active ? "primary" : "default"} {...restProps} />;
}

export default ButtonComponent;
