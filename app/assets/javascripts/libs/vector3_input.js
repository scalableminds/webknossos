// @flow
import type { Vector3 } from "oxalis/constants";
import * as React from "react";
import Utils from "libs/utils";
import _ from "lodash";
import { Input } from "antd";

type Vector3InputPropTypes = {
  value: Vector3 | string,
  onChange: (value: Vector3) => void,
};

type State = {
  isEditing: boolean,
  isValid: boolean,
  text: string,
};

export default class Vector3Input extends React.PureComponent<Vector3InputPropTypes, State> {
  constructor(props: Vector3InputPropTypes) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: this.getText(props.value),
    };
  }

  componentWillReceiveProps(newProps: Vector3InputPropTypes) {
    if (!this.state.isEditing) {
      this.setState({
        isValid: true,
        text: this.getText(newProps.value),
      });
    }
  }

  getText(value: Vector3 | string): string {
    if (_.isArray(value)) {
      return value.join(", ");
    } else if (_.isString(value)) {
      return value;
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
        text: this.getText(this.props.value),
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
      text: this.getText(this.props.value),
      isValid: true,
    });
  };

  handleChange = (evt: SyntheticInputEvent<>) => {
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
