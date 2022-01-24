// @flow
import * as React from "react";
import _ from "lodash";

import type { ServerBoundingBoxTypeTuple } from "types/api_flow_types";
import type { Vector3, Vector6 } from "oxalis/constants";
import InputComponent from "oxalis/view/components/input_component";
import * as Utils from "libs/utils";

type BaseProps<T> = {
  value: T | string,
  onChange: (value: T) => void,
  changeOnlyOnBlur?: boolean,
  allowDecimals?: boolean,
};

type State = {
  isEditing: boolean,
  isValid: boolean,
  text: string,
};

// Accepts both a string or a VectorX as input and always outputs a valid VectorX
class BaseVector<T: Vector3 | Vector6> extends React.PureComponent<BaseProps<T>, State> {
  defaultValue: T;
  static defaultProps = {
    value: "",
    onChange: () => {},
  };

  constructor(props: BaseProps<T>) {
    super(props);
    this.state = {
      isEditing: false,
      isValid: true,
      text: this.getText(props.value),
    };
  }

  componentDidUpdate(prevProps: BaseProps<T>) {
    if (!this.state.isEditing && prevProps.value !== this.props.value) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({
        isValid: true,
        text: this.getText(this.props.value),
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
      this.setState(prevState => {
        const fallbackValue = this.makeInvalidValueValid(prevState.text);
        this.props.onChange(fallbackValue);
        return {
          isValid: true,
          text: fallbackValue.join(", "),
        };
      });
    }
  };

  makeInvalidValueValid(text: string): T {
    const validSubVector = text
      .replace(this.props.allowDecimals ? /[^0-9,.]/gm : /[^0-9,]/gm, "")
      .split(",")
      .map(el => parseFloat(el) || 0)
      .slice(0, this.defaultValue.length);
    const paddedVector = validSubVector.concat(this.defaultValue.slice(validSubVector.length));
    const vector = ((paddedVector: any): T);
    return vector;
  }

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
    const isValidInput = this.props.allowDecimals
      ? /^[\d\s,.]*$/g.test(text)
      : /^[\d\s,]*$/g.test(text);

    const value = Utils.stringToNumberArray(text);
    const isValidFormat = value.length === this.defaultValue.length;

    if (isValidFormat && isValidInput && !this.props.changeOnlyOnBlur) {
      const vector = ((value: any): T);
      this.props.onChange(vector);
    }

    this.setState({
      text,
      isValid: isValidFormat,
    });
  };

  render() {
    const { style, autoSize, ...props } = _.omit(this.props, [
      "onChange",
      "value",
      "changeOnlyOnBlur",
      "allowDecimals",
    ]);

    return (
      <InputComponent
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.text}
        style={
          autoSize ? { ...style, width: this.getText(this.state.text).length * 8 + 25 } : style
        }
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
  value: ServerBoundingBoxTypeTuple,
  onChange: ServerBoundingBoxTypeTuple => void,
};

function boundingBoxToVector6(value: ServerBoundingBoxTypeTuple): Vector6 {
  const { topLeft, width, height, depth } = value;
  const [x, y, z] = topLeft;
  return [x, y, z, width, height, depth];
}

const emptyBoundingBox = {
  topLeft: [0, 0, 0],
  width: 0,
  height: 0,
  depth: 0,
};

export class BoundingBoxInput extends React.PureComponent<BoundingBoxInputProps> {
  static defaultProps = {
    value: emptyBoundingBox,
    onChange: () => {},
  };

  render() {
    const { value, onChange, ...props } = this.props;
    const vector6Value = boundingBoxToVector6(value || emptyBoundingBox);
    return (
      <Vector6Input
        {...props}
        value={vector6Value}
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
