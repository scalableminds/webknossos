import type { ButtonProps } from "antd";
import type React from "react";
import { useState } from "react";

export type HoverButtonProps = Omit<ButtonProps, "icon"> & {
  icon: React.ReactElement<any>;
  hoveredIcon: React.ReactElement<any>;
};

export function HoverIconButton(props: HoverButtonProps) {
  const [isMouseOver, setIsMouseOver] = useState<boolean>(false);

  const onMouseEnter = (event: React.MouseEvent<HTMLElement, MouseEvent>) => {
    setIsMouseOver(true);
    if (props.onMouseEnter != null) {
      props.onMouseEnter(event);
    }
  };
  const onMouseLeave = (event: React.MouseEvent<HTMLElement, MouseEvent>) => {
    setIsMouseOver(false);
    if (props.onMouseLeave != null) {
      props.onMouseLeave(event);
    }
  };
  const { hoveredIcon, ...restProps } = props;
  return React.cloneElement(isMouseOver ? hoveredIcon : props.icon, {
    ...restProps,
    onMouseEnter,
    onMouseLeave,
  });
}
export default {};
