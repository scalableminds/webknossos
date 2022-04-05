import { Button, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";
type ButtonComponentProp = {
  onClick?: (...args: Array<any>) => any;
  faIcon?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
  title?: React.ReactNode;
  style?: React.CSSProperties;
  value?: string;
};
/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 */

class ButtonComponent extends React.PureComponent<ButtonComponentProp> {
  static defaultProps: ButtonComponentProp = {
    onClick: _.noop,
  };

  handleClick = (e: React.SyntheticEvent<HTMLButtonElement>) => {
    // For antd buttons e.target seems to be the span with the button description, whereas
    // e.currentTarget is the actual button
    e.currentTarget.blur();

    if (this.props.onClick) {
      this.props.onClick(e);
    }
  };

  render() {
    const { children, faIcon, title, ...restProps } = this.props;
    const button = (
      // @ts-expect-error ts-migrate(2322) FIXME: Type '(e: React.SyntheticEvent<HTMLButtonElement>)... Remove this comment to see the full error message
      <Button {...restProps} onClick={this.handleClick}>
        {faIcon != null && !this.props.loading ? <i className={faIcon} /> : null}
        {children}
      </Button>
    );
    return title != null ? <Tooltip title={title}>{button}</Tooltip> : button;
  }
}

export default ButtonComponent;
