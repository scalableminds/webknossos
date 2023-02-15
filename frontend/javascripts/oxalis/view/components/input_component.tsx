import { Input, InputProps, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";

type InputComponentState = {
  isFocused: boolean;
  currentValue: React.InputHTMLAttributes<HTMLInputElement>["value"];
}; // TODO Double check if we still need this once React v16 is released.

/*
 * A lightweight wrapper around <Input> to deal with a "jumping cursor" bug.
 * Modifying a input's value will always reset the cursor to the end even if
 * you are editing the middle of a string. Saving the input's value in state
 * remedies this. Rumors claim React v16 will fix this.
 * Inspired by https://github.com/facebook/react/issues/955#issuecomment-281802381
 * @class
 */

class InputComponent extends React.PureComponent<InputProps, InputComponentState> {
  static defaultProps: InputProps = {
    onChange: _.noop,
    placeholder: "",
    value: "",
    style: {},
  };

  state = {
    isFocused: false,
    currentValue: this.props.value,
  };

  componentDidUpdate(prevProps: InputProps) {
    if (!this.state.isFocused && prevProps.value !== this.props.value) {
      this.setState({
        currentValue: this.props.value,
      });
    }
  }

  handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      currentValue: e.target.value,
    });

    if (this.props.onChange) {
      this.props.onChange(e);
    }
  };

  handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    this.setState({
      isFocused: true,
    });

    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    this.setState(
      {
        isFocused: false,
      },
      () => {
        if (this.props.onBlur) {
          this.props.onBlur(e);
        }
      },
    );
  };

  blurYourself = () =>
    document.activeElement ? (document.activeElement as HTMLElement).blur() : null;

  blurOnEscape = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.blurYourself();
    }
  };

  render() {
    const { title, style, ...inputProps } = this.props;
    const input = (
      <Input
        {...inputProps}
        style={title == null ? style : undefined}
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.currentValue}
        onKeyDown={this.blurOnEscape}
      />
    );

    // The input needs to be wrapped in a span in order for the tooltip to work. See https://github.com/react-component/tooltip/issues/18#issuecomment-140078802.
    return title != null ? (
      <Tooltip title={title} style={style}>
        <span>{input}</span>
      </Tooltip>
    ) : (
      input
    );
  }
}

export default InputComponent;
