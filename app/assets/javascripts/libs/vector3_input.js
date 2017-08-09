// @flow
import type { Vector3 } from "oxalis/constants";
import React from "react";
import Utils from "libs/utils";
import _ from "lodash";
import { Input } from "antd";

type Vector3InputPropTypes = {
  value: Vector3,
  onChange: (value: Vector3) => void,
};

export default class Vector3Input extends React.PureComponent {
  props: Vector3InputPropTypes;
  state: {
    isEditing: boolean,
    isValid: boolean,
    text: string,
  };

  constructor(props: Vector3InputPropTypes) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: props.value.join(", "),
    };
  }

  componentWillReceiveProps(newProps: Vector3InputPropTypes) {
    if (!this.state.isEditing) {
      this.setState({
        isValid: true,
        text: newProps.value.join(", "),
      });
    }
  }

  defaultValue: Vector3 = [0, 0, 0];

  handleBlur = () => {
    this.setState({
      isEditing: false,
    });
    if (this.state.isValid) {
      this.setState({
        isValid: true,
        text: this.props.value.join(", "),
      });
    } else {
      this.props.onChange(this.defaultValue);
      this.setState({
        isValid: true,
        text: this.defaultValue.join(", "),
      });
    }
  };

  handleFocus = () => {
    this.setState({
      isEditing: true,
      text: this.props.value.join(", "),
      isValid: true,
    });
  };

  handleChange = (evt: SyntheticInputEvent) => {
    const text = evt.target.value;

    // only numbers, commas and whitespace is allowed
    const isValidInput = /^[\d\s,]*$/g.test(text);
    const value = Utils.stringToNumberArray(text);
    const isValidFormat = value.length === 3;

    if (isValidFormat && isValidInput) {
      this.props.onChange(Utils.numberArrayToVector3(value));
    }

    this.setState({
      text,
      isValid: isValidFormat,
    });
  };

  render() {
    const props = _.omit(this.props, ["onChange", "value"]);
    return (
      <Input
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.text}
        {...props}
      />
    );
  }
}
