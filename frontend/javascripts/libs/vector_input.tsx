import type { InputProps } from "antd";
import * as Utils from "libs/utils";
import _ from "lodash";
import * as React from "react";
import type { ServerBoundingBoxTypeTuple } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import InputComponent from "viewer/view/components/input_component";

const CHARACTER_WIDTH_PX = 8;

type BaseProps<T> = Omit<InputProps, "value" | "onChange"> & {
  value: T | string;
  onChange: (value: T) => void;
  changeOnlyOnBlur?: boolean;
  allowDecimals?: boolean;
  autoSize?: boolean;
  // Only used in ArbitraryVectorInput case
  vectorLength?: number;
};
type State = {
  isEditing: boolean;
  isValid: boolean;
  text: string;
}; // Accepts both a string or a VectorX as input and always outputs a valid VectorX

abstract class BaseVector<T extends number[]> extends React.PureComponent<BaseProps<T>, State> {
  abstract get defaultValue(): T;
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

  handleBlur = (_: React.FocusEvent<HTMLInputElement>) => {
    this.setState({
      isEditing: false,
    });

    if (this.state.isValid) {
      if (this.props.changeOnlyOnBlur) {
        const vector = Utils.stringToNumberArray(this.state.text) as any as T;
        this.props.onChange(vector);
      } else {
        this.setState({
          isValid: true,
          text: this.getText(this.props.value),
        });
      }
    } else {
      this.setState((prevState) => {
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
      .map((el) => Number.parseFloat(el) || 0)
      .slice(0, this.defaultValue.length);
    const paddedVector = validSubVector.concat(this.defaultValue.slice(validSubVector.length));
    const vector = paddedVector as any as T;
    return vector;
  }

  handleFocus = (_event: React.FocusEvent<HTMLInputElement>) => {
    this.setState({
      isEditing: true,
      text: this.getText(this.props.value),
      isValid: true,
    });
  };

  handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const text = evt.target.value;
    // only numbers, commas and whitespace is allowed
    const isValidInput = this.props.allowDecimals
      ? /^[\d\s,.]*$/g.test(text)
      : /^[\d\s,]*$/g.test(text);
    const value = Utils.stringToNumberArray(text);
    const isValidFormat = value.length === this.defaultValue.length;

    if (isValidFormat && isValidInput && !this.props.changeOnlyOnBlur) {
      const vector = value as any as T;
      this.props.onChange(vector);
    }

    this.setState({
      text,
      isValid: isValidFormat,
    });
  };

  handleOnKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    /* Increment/decrement current value when using arrow up/down */
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    const { selectionStart, value } = event.target as HTMLInputElement;
    const vec = Utils.stringToNumberArray(value) as T;

    // Count commas before the selection to obtain the index of the current element
    const vectorIndex = Array.from((value as string).slice(0, selectionStart || 0)).filter(
      (el: string) => el === ",",
    ).length;
    if (event.key === "ArrowUp") {
      vec[vectorIndex] += 1;
    } else {
      vec[vectorIndex] -= 1;
    }
    this.props.onChange(vec);
    const text = vec.join(", ");
    this.setState({ text });
  };

  render() {
    const {
      style,
      autoSize,
      vectorLength: _vectorLength,
      ...props
    } = _.omit(this.props, ["onChange", "value", "changeOnlyOnBlur", "allowDecimals"]);

    const { addonBefore } = props;
    const addonBeforeLength =
      typeof addonBefore === "string" ? 20 + CHARACTER_WIDTH_PX * addonBefore.length : 0;

    return (
      <InputComponent
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        value={this.state.text}
        onKeyDown={this.handleOnKeyDown}
        style={
          autoSize
            ? {
                ...style,
                width:
                  this.getText(this.state.text).length * CHARACTER_WIDTH_PX +
                  25 +
                  addonBeforeLength,
              }
            : style
        }
        {...props}
        // onBlur needs to be placed below the ...props spread
        // to ensure that it isn't overridden. User-specified onBlurs
        // are not supported (see Props type), but might be passed
        // nevertheless (e.g., when the VectorInput is a child of a
        // Popover component). Until now, it hasn't raised any problems
        // (the Popover example merely passed undefined as onBlur, anyway).
        onBlur={this.handleBlur}
      />
    );
  }
}

export class Vector3Input extends BaseVector<Vector3> {
  get defaultValue(): Vector3 {
    return [0, 0, 0];
  }
}
export class Vector6Input extends BaseVector<Vector6> {
  get defaultValue(): Vector6 {
    return [0, 0, 0, 0, 0, 0];
  }
}

export class ArbitraryVectorInput extends BaseVector<number[]> {
  get defaultValue(): number[] {
    return Array(this.props.vectorLength).fill(0);
  }
}

type BoundingBoxInputProps = Omit<InputProps, "value"> & {
  value: ServerBoundingBoxTypeTuple;
  onChange: (arg0: ServerBoundingBoxTypeTuple) => void;
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
