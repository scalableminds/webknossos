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

class InputComponent extends React.PureComponent {

  state: InputComponentStateType = {
    isFocused: false,
    currentValue: this.props.value,
  };

  componentWillReceiveProps = (nextProps: InputComponentPropType) => {
    if (!this.state.isFocused) {
      this.setState({ currentValue: nextProps.value });
    }
  }

  props: InputComponentPropType = {
    onChange: _.noop,
    onFocus: _.noop,
    onBlur: _.noop,
    placeholder: "",
    value: "",
  }

  handleChange = (e: SyntheticInputEvent) => {
    this.setState({ currentValue: e.target.value });
    if (this.props.onChange) {
      this.props.onChange(e);
    }
  }

  handleFocus = (e: SyntheticInputEvent) => {
    this.setState({ isFocused: true });
    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  }

  handleBlur = (e: SyntheticInputEvent) => {
    this.setState({ isFocused: false });
    if (this.props.onBlur) {
      this.props.onBlur(e);
    }
  }

  render() {
    return (<Input
      {...this.props}
      onChange={this.handleChange}
      onFocus={this.handleFocus}
      onBlur={this.handleBlur}
      value={this.state.currentValue}
      style={this.props.style}
      placeholder={this.props.placeholder}
    />);
  }
}

export default InputComponent;
