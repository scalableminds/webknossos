import type React from "react";
import { useState } from "react";
import ButtonComponent from "viewer/view/components/button_component";

export type HoverButtonProps = React.ComponentProps<typeof ButtonComponent> & {
  icon: React.ReactElement<any>;
  hoveredIcon: React.ReactElement<any>;
};

export function HoverIconButton(props: HoverButtonProps) {
  const [isMouseOver, setIsMouseOver] = useState<boolean>(false);

  const onMouseEnter = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    setIsMouseOver(true);
    if (props.onMouseEnter != null) {
      props.onMouseEnter(event);
    }
  };
  const onMouseLeave = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    setIsMouseOver(false);
    if (props.onMouseLeave != null) {
      props.onMouseLeave(event);
    }
  };
  const { hoveredIcon, icon, ...restProps } = props;
  return (
    <ButtonComponent
      {...restProps}
      icon={isMouseOver ? hoveredIcon : icon}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}
export default {};
