// @flow

import React from "react";
import _ from "lodash";
import { Input } from "antd";

type InputComponentPropType = {
  onChange?: Function,
  onFocus?: Function,
  onBlur?: Function,
  placeholder?: string,
  value: string,
  style?: any,
};

type InputComponentStateType = {
  isFocused: boolean,
  currentValue: string,
};

// TODO Double check if we still need this once React v16 is released.

/*
 * A lightweight wrapper around <Input> to deal with a "jumping cursor" bug.
 * Modifying a input's value will always reset the cursor to the end even if
 * you are editting the middle of a string. Saving the input's value in state
 * remedies this. Rumors claim React v16 will fix this.
 * Inspired by https://github.com/facebook/react/issues/955#issuecomment-281802381
 * @class
 */
class InputComponent extends React.PureComponent {
  props: InputComponentPropType;
  static defaultProps: InputComponentPropType = {
    onChange: _.noop,
    onFocus: _.noop,
    onBlur: _.noop,
    placeholder: "",
    value: "",
    style: {},
  };

  state: InputComponentStateType = {
    isFocused: false,
    currentValue: this.props.value,
  };

  componentWillReceiveProps = (nextProps: InputComponentPropType) => {
    if (!this.state.isFocused) {
      this.setState({ currentValue: nextProps.value });
    }
  };

  handleChange = (e: SyntheticInputEvent) => {
    this.setState({ currentValue: e.target.value });
    if (this.props.onChange) {
      this.props.onChange(e);
    }
  };

  handleFocus = (e: SyntheticInputEvent) => {
    this.setState({ isFocused: true });
    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: SyntheticInputEvent) => {
    this.setState({ isFocused: false });
    if (this.props.onBlur) {
      this.props.onBlur(e);
    }
  };

  render() {
    return (
      <Input
        {...this.props}
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.currentValue}
        style={this.props.style}
        placeholder={this.props.placeholder}
      />
    );
  }
}

export default InputComponent;
