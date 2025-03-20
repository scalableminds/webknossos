import { Checkbox } from "antd";
import _ from "lodash";
import * as React from "react";
type CheckboxComponentProp = {
  onClick?: (...args: Array<any>) => any;
};
/*
 * A lightweight wrapper around <Checkbox> to automatically blur the checkbox
 * after it was clicked.
 */

class CheckboxComponent extends React.PureComponent<CheckboxComponentProp> {
  static defaultProps: CheckboxComponentProp = {
    onClick: _.noop,
  };

  handleClick = (e: React.SyntheticEvent<HTMLInputElement>) => {
    // For antd checkboxs e.target seems to be the span with the checkbox description, whereas
    // e.currentTarget is the actual checkbox
    e.currentTarget.blur();

    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    // @ts-expect-error ts-migrate(2322) FIXME: Type '(e: React.SyntheticEvent<HTMLInputElement>) ... Remove this comment to see the full error message
    return <Checkbox {...this.props} onClick={this.handleClick} />;
  }
}

export default CheckboxComponent;
