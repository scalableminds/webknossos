// @flow

import * as React from "react";
import _ from "lodash";
import { Button } from "antd";

type ButtonComponentPropType = {
  onClick?: Function,
};

/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 */
class ButtonComponent extends React.PureComponent<ButtonComponentPropType> {
  static defaultProps: ButtonComponentPropType = {
    onClick: _.noop,
  };

  handleClick = (e: Event & { currentTarget: HTMLButtonElement }) => {
    // For antd buttons e.target seems to be the span with the button description, whereas
    // e.currentTarget is the actual button
    if (e != null && e.currentTarget != null) {
      e.currentTarget.blur();
    }
    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    return <Button {...this.props} onClick={this.handleClick} />;
  }
}

export default ButtonComponent;
