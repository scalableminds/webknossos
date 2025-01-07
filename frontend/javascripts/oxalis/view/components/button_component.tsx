import { Button, type ButtonProps } from "antd";
import * as React from "react";
import _ from "lodash";
import FastTooltip, { type FastTooltipPlacement } from "components/fast_tooltip";

type ButtonComponentProps = ButtonProps & {
  faIcon?: string;
  tooltipPlacement?: FastTooltipPlacement | undefined;
};
/*
 * A lightweight wrapper around <Button> to automatically blur the button
 * after it was clicked.
 */

class ButtonComponent extends React.PureComponent<ButtonComponentProps> {
  static defaultProps: ButtonComponentProps = {
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

  handleTouchEnd = (e: React.TouchEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();

    if (this.props.onTouchEnd) {
      this.props.onTouchEnd(e);
    }
  };

  render() {
    const { children, faIcon, title, tooltipPlacement, ...restProps } = this.props;
    const iconEl = faIcon != null && !this.props.loading ? <i className={faIcon} /> : null;
    const button =
      // Differentiate via children != null, since antd uses a different styling for buttons
      // with a single icon child (.ant-btn-icon-only will be assigned)
      children != null ? (
        <Button {...restProps} onClick={this.handleClick} onTouchEnd={this.handleTouchEnd}>
          {iconEl}
          {children}
        </Button>
      ) : (
        <Button {...restProps} onClick={this.handleClick} onTouchEnd={this.handleTouchEnd}>
          {iconEl}
        </Button>
      );
    return title != null ? (
      <FastTooltip title={title} placement={tooltipPlacement}>
        {button}
      </FastTooltip>
    ) : (
      button
    );
  }
}

export function ToggleButton(props: { active: boolean } & ButtonComponentProps) {
  const { active, ...restProps } = props;
  return <ButtonComponent type={active ? "primary" : "default"} {...restProps} />;
}

export default ButtonComponent;
