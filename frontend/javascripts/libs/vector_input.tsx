import type { InputProps, InputRef } from "antd";
import _ from "lodash";
import type React from "react";
import { PureComponent, forwardRef } from "react";
import type { ServerBoundingBoxMinMaxTypeTuple } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import InputComponent from "viewer/view/components/input_component";
import { stringToNumberArray } from "./utils";

const CHARACTER_WIDTH_PX = 8;

type BaseProps<T> = Omit<InputProps, "value" | "onChange"> & {
  value?: T | string;
  onChange?: (value: T) => void;
  changeOnlyOnBlur?: boolean;
  allowDecimals?: boolean;
  autoSize?: boolean;
  // Only used in ArbitraryVectorInput case
  vectorLength?: number;
  inputRef?: React.Ref<InputRef>;
};
type State = {
  isEditing: boolean;
  isValid: boolean;
  text: string;
}; // Accepts both a string or a VectorX as input and always outputs a valid VectorX

abstract class BaseVector<T extends number[]> extends PureComponent<BaseProps<T>, State> {
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
      text: this.getText(props.value ?? BaseVector.defaultProps.value),
    };
  }

  getValue() {
    return this.props.value ?? BaseVector.defaultProps.value;
  }

  getOnChangeFn() {
    return this.props.onChange ?? BaseVector.defaultProps.onChange;
  }

  componentDidUpdate(prevProps: BaseProps<T>) {
    if (!this.state.isEditing && prevProps.value !== this.props.value) {
      this.setState({
        isValid: true,
        text: this.getText(this.getValue()),
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
        const vector = stringToNumberArray(this.state.text) as any as T;
        this.getOnChangeFn()(vector);
      } else {
        this.setState({
          isValid: true,
          text: this.getText(this.getValue()),
        });
      }
    } else {
      this.setState((prevState) => {
        const fallbackValue = this.makeInvalidValueValid(prevState.text);
        this.getOnChangeFn()(fallbackValue);
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
      text: this.getText(this.getValue()),
      isValid: true,
    });
  };

  handleChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const text = evt.target.value;
    // only numbers, commas and whitespace is allowed
    const isValidInput = this.props.allowDecimals
      ? /^[\d\s,.]*$/g.test(text)
      : /^[\d\s,]*$/g.test(text);
    const value = stringToNumberArray(text);
    const isValidFormat = value.length === this.defaultValue.length;

    if (isValidFormat && isValidInput && !this.props.changeOnlyOnBlur) {
      const vector = value as any as T;
      this.getOnChangeFn()(vector);
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
    const vec = stringToNumberArray(value) as T;

    // Count commas before the selection to obtain the index of the current element
    const vectorIndex = Array.from((value as string).slice(0, selectionStart || 0)).filter(
      (el: string) => el === ",",
    ).length;
    if (event.key === "ArrowUp") {
      vec[vectorIndex] += 1;
    } else {
      vec[vectorIndex] -= 1;
    }
    this.getOnChangeFn()(vec);
    const text = vec.join(", ");
    this.setState({ text });
  };

  render() {
    const { inputRef } = this.props;
    const {
      style,
      autoSize,
      vectorLength: _vectorLength,
      ...props
    } = _.omit(this.props, ["onChange", "value", "changeOnlyOnBlur", "allowDecimals", "inputRef"]);

    const { addonBefore } = props;
    const addonBeforeLength =
      typeof addonBefore === "string" ? 20 + CHARACTER_WIDTH_PX * addonBefore.length : 0;

    return (
      <InputComponent
        ref={inputRef}
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

class Vector3InputBase extends BaseVector<Vector3> {
  get defaultValue(): Vector3 {
    return [0, 0, 0];
  }
}

class Vector6InputBase extends BaseVector<Vector6> {
  get defaultValue(): Vector6 {
    return [0, 0, 0, 0, 0, 0];
  }
}

class ArbitraryVectorInputBase extends BaseVector<number[]> {
  get defaultValue(): number[] {
    return Array(this.props.vectorLength).fill(0);
  }
}

export const Vector3Input = forwardRef<InputRef, BaseProps<Vector3>>((props, ref) => (
  <Vector3InputBase {...props} inputRef={ref} />
));

export const Vector6Input = forwardRef<InputRef, BaseProps<Vector6>>((props, ref) => (
  <Vector6InputBase {...props} inputRef={ref} />
));

export const ArbitraryVectorInput = forwardRef<InputRef, BaseProps<number[]>>((props, ref) => (
  <ArbitraryVectorInputBase {...props} inputRef={ref} />
));

type BoundingBoxInputProps = Omit<InputProps, "value"> & {
  value: ServerBoundingBoxMinMaxTypeTuple;
  onChange: (arg0: ServerBoundingBoxMinMaxTypeTuple) => void;
};

function boundingBoxToVector6(value: ServerBoundingBoxMinMaxTypeTuple): Vector6 {
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

export class BoundingBoxInput extends PureComponent<BoundingBoxInputProps> {
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
