import { Checkbox } from "antd";
import _ from "lodash";
import type React from "react";
type CheckboxComponentProp = {
  onClick?: (...args: Array<any>) => any;
};
/*
 * A lightweight wrapper around <Checkbox> to automatically blur the checkbox
 * after it was clicked.
 */

function CheckboxComponent(props: CheckboxComponentProp) {
  const { onClick = _.noop, ...restProps } = props;

  const handleClick: React.MouseEventHandler<HTMLElement> = (e) => {
    // For antd checkboxs e.target seems to be the span with the checkbox description, whereas
    // e.currentTarget is the actual checkbox
    e.currentTarget.blur();
    onClick(e);
  };

  return <Checkbox {...restProps} onClick={handleClick} />;
}

export default CheckboxComponent;
