// @flow

import { Checkbox } from "antd";
import * as React from "react";
import _ from "lodash";

type CheckboxComponentProp = {
  onClick?: Function,
};

/*
 * A lightweight wrapper around <Checkbox> to automatically blur the checkbox
 * after it was clicked.
 */
class CheckboxComponent extends React.PureComponent<CheckboxComponentProp> {
  static defaultProps: CheckboxComponentProp = {
    onClick: _.noop,
  };

  handleClick = (e: SyntheticEvent<HTMLInputElement>) => {
    // For antd checkboxs e.target seems to be the span with the checkbox description, whereas
    // e.currentTarget is the actual checkbox
    e.currentTarget.blur();

    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    return <Checkbox {...this.props} onClick={this.handleClick} />;
  }
}

export default CheckboxComponent;
