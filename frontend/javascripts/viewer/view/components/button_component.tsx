import { Button, type ButtonProps } from "antd";
import FastTooltip, { type FastTooltipPlacement } from "components/fast_tooltip";
import noop from "lodash-es/noop";
import type React from "react";

type ButtonComponentProps = ButtonProps & {
  ref?: React.Ref<HTMLButtonElement>;
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

const ButtonComponent: React.FC<ButtonComponentProps> = (props) => {
  const {
    children,
    title,
    tooltipPlacement,
    onClick = noop,
    onTouchEnd,
    ref,
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
};

export const ToggleButton: React.FC<
  { ref?: React.Ref<HTMLButtonElement | HTMLAnchorElement>; active: boolean } & ButtonComponentProps
> = (props) => {
  const { active, ref, ...restProps } = props;
  return <ButtonComponent type={active ? "primary" : "default"} {...restProps} ref={ref} />;
};

export default ButtonComponent;
