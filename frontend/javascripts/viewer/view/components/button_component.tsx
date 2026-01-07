import { Button, type ButtonProps } from "antd";
import FastTooltip, { type FastTooltipPlacement } from "components/fast_tooltip";
import noop from "lodash/noop";
import React from "react";

type ButtonComponentProps = ButtonProps & {
  tooltipPlacement?: FastTooltipPlacement | undefined;
};
/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 *
 * We use `forwardRef` to pass the ref to the underlying `Button` component.
 * This is required for Ant Design's `Dropdown` (and other overlay components)
 * to correctly calculate the position of the popup relative to this trigger.
 */

const ButtonComponent = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonComponentProps
>((props, ref) => {
  const { children, title, tooltipPlacement, onClick = noop, onTouchEnd, ...restProps } = props;

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

  const button = (
    <Button {...restProps} onClick={handleClick} onTouchEnd={handleTouchEnd} ref={ref}>
      {children}
    </Button>
  );

  return title != null ? (
    <FastTooltip title={title} placement={tooltipPlacement}>
      {button}
    </FastTooltip>
  ) : (
    button
  );
});

export const ToggleButton = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  { active: boolean } & ButtonComponentProps
>((props, ref) => {
  const { active, ...restProps } = props;
  return <ButtonComponent type={active ? "primary" : "default"} {...restProps} ref={ref} />;
});

export default ButtonComponent;
