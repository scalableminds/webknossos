import { ButtonProps } from "antd";
import * as React from "react";
const { useState } = React;

export type HoverButtonProps = Omit<ButtonProps, "icon"> & {
  icon: React.ReactElement<any>;
  hoveredIcon: React.ReactElement<any>;
};

export function HoverIconButton(props: HoverButtonProps) {
  const [isMouseOver, setIsMouseOver] = useState<boolean>(false);

  const onMouseEnter = (event: React.MouseEvent) => {
    setIsMouseOver(true);
    if (props.onMouseEnter != null) {
      props.onMouseEnter(event);
    }
  };
  const onMouseLeave = (event: React.MouseEvent) => {
    setIsMouseOver(false);
    if (props.onMouseLeave != null) {
      props.onMouseLeave(event);
    }
  };

  return React.cloneElement(isMouseOver ? props.hoveredIcon : props.icon, {
    ...props,
    onMouseEnter,
    onMouseLeave,
  });
}
export default {};
