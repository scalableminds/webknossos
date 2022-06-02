import { Button, ButtonProps, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";
type ButtonComponentProp = ButtonProps & {
  faIcon?: string;
};
/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 */

class ButtonComponent extends React.PureComponent<ButtonComponentProp> {
  static defaultProps: ButtonComponentProp = {
    onClick: _.noop,
  };

  handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // For antd buttons e.target seems to be the span with the button description, whereas
    // e.currentTarget is the actual button
    e.currentTarget.blur();

    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    const { children, faIcon, title, ...restProps } = this.props;
    const iconEl = faIcon != null && !this.props.loading ? <i className={faIcon} /> : null;
    const button =
      // Differentiate via children != null, since antd uses a different styling for buttons
      // with a single icon child (.ant-btn-icon-only will be assigned)
      children != null ? (
        <Button {...restProps} onClick={this.handleClick}>
          {iconEl}
          {children}
        </Button>
      ) : (
        <Button {...restProps} onClick={this.handleClick}>
          {iconEl}
        </Button>
      );
    return title != null ? <Tooltip title={title}>{button}</Tooltip> : button;
  }
}

export default ButtonComponent;
