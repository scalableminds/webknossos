// @flow

import * as React from "react";
import _ from "lodash";
import { Checkbox } from "antd";

type CheckboxComponentPropType = {
  onClick?: Function,
};

/*
 * A lightweight wrapper around <Checkbox> to automatically blur the checkbox
 * after it was clicked.
 */
class CheckboxComponent extends React.PureComponent<CheckboxComponentPropType> {
  static defaultProps: CheckboxComponentPropType = {
    onClick: _.noop,
  };

  handleClick = (e: Event & { currentTarget: HTMLElement }) => {
    // For antd checkboxs e.target seems to be the span with the checkbox description, whereas
    // e.currentTarget is the actual checkbox
    if (e != null && e.currentTarget != null) {
      e.currentTarget.blur();
    }
    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    return <Checkbox {...this.props} onClick={this.handleClick} />;
  }
}

export default CheckboxComponent;
