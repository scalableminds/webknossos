// @flow

import { Button } from "antd";
import * as React from "react";
import _ from "lodash";

type ButtonComponentProp = {
  onClick?: Function,
  faIcon?: string,
  loading?: boolean,
  children?: React.Node,
};

/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 */
class ButtonComponent extends React.PureComponent<ButtonComponentProp> {
  static defaultProps: ButtonComponentProp = {
    onClick: _.noop,
  };

  handleClick = (e: SyntheticEvent<HTMLButtonElement>) => {
    // For antd buttons e.target seems to be the span with the button description, whereas
    // e.currentTarget is the actual button
    e.currentTarget.blur();

    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    const { children, faIcon, ...restProps } = this.props;
    return (
      <Button {...restProps} onClick={this.handleClick}>
        {faIcon != null && !this.props.loading ? <i className={faIcon} /> : null}
        {children}
      </Button>
    );
  }
}

export default ButtonComponent;
