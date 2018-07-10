// @flow
/* eslint-disable prefer-default-export */
import type { Vector3, Vector6 } from "oxalis/constants";
import * as React from "react";
import Utils from "libs/utils";
import _ from "lodash";
import { Input } from "antd";
import type { ServerBoundingBoxType } from "admin/api_flow_types";

type BaseProps<T> = {
  value: T | string,
  onChange: (value: T) => void,
  changeOnlyOnBlur?: boolean,
};

type State = {
  isEditing: boolean,
  isValid: boolean,
  text: string,
};

// Accepts both a string or a VectorX as input and always outputs a valid VectorX
class BaseVector<T: Vector3 | Vector6> extends React.PureComponent<BaseProps<T>, State> {
  defaultValue: T;

  constructor(props: BaseProps<T>) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: this.getText(props.value),
    };
  }

  componentWillReceiveProps(newProps: BaseProps<T>) {
    if (!this.state.isEditing) {
      this.setState({
        isValid: true,
        text: this.getText(newProps.value),
      });
    }
  }

  getText(value: T | string): string {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    return value;
  }

  handleBlur = () => {
    this.setState({
      isEditing: false,
    });
    if (this.state.isValid) {
      if (this.props.changeOnlyOnBlur) {
        const vector = ((Utils.stringToNumberArray(this.state.text): any): T);
        this.props.onChange(vector);
      } else {
        this.setState({
          isValid: true,
          text: this.getText(this.props.value),
        });
      }
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
    const isValidFormat = value.length === this.defaultValue.length;

    if (isValidFormat && isValidInput) {
      if (!this.props.changeOnlyOnBlur) {
        const vector = ((value: any): T);
        this.props.onChange(vector);
      }
    }

    this.setState({
      text,
      isValid: isValidFormat,
    });
  };

  render() {
    const props = _.omit(this.props, ["onChange", "value", "changeOnlyOnBlur"]);
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

export class Vector3Input extends BaseVector<Vector3> {
  defaultValue: Vector3 = [0, 0, 0];
}

export class Vector6Input extends BaseVector<Vector6> {
  defaultValue: Vector6 = [0, 0, 0, 0, 0, 0];
}

type BoundingBoxInputProps = {
  value: ServerBoundingBoxType,
  onChange: ServerBoundingBoxType => void,
};

export class BoundingBoxInput extends React.PureComponent<{}> {
  render() {
    const { value, onChange, ...props } = this.props;
    const { topLeft, width, height, depth } = value || {
      topLeft: [0, 0, 0],
      width: 0,
      height: 0,
      depth: 0,
    };
    return (
      <Vector6Input
        {...props}
        value={topLeft.concat(width, height, depth)}
        changeOnlyOnBlur
        onChange={([x, y, z, width, height, depth]) =>
          onChange({
            topLeft: [x, y, z],
            width,
            height,
            depth,
          })
        }
      />
    );
  }
}
