import { Input } from "antd";
import * as React from "react";
import _ from "lodash";
type InputComponentProp = {
  onChange?: (...args: Array<any>) => any;
  onFocus?: (...args: Array<any>) => any;
  onBlur?: (...args: Array<any>) => any;
  onPressEnter?: (...args: Array<any>) => any;
  placeholder?: string;
  value: string;
  style?: any;
  isTextArea?: boolean;
};
type InputComponentState = {
  isFocused: boolean;
  currentValue: string;
}; // TODO Double check if we still need this once React v16 is released.

/*
 * A lightweight wrapper around <Input> to deal with a "jumping cursor" bug.
 * Modifying a input's value will always reset the cursor to the end even if
 * you are editing the middle of a string. Saving the input's value in state
 * remedies this. Rumors claim React v16 will fix this.
 * Inspired by https://github.com/facebook/react/issues/955#issuecomment-281802381
 * @class
 */

class InputComponent extends React.PureComponent<InputComponentProp, InputComponentState> {
  static defaultProps: InputComponentProp = {
    onChange: _.noop,
    onFocus: _.noop,
    onBlur: _.noop,
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type '((...args: ... Remove this comment to see the full error message
    onPressEnter: null,
    placeholder: "",
    value: "",
    style: {},
    isTextArea: false,
  };

  state = {
    isFocused: false,
    currentValue: this.props.value,
  };

  componentDidUpdate = (prevProps: InputComponentProp) => {
    if (!this.state.isFocused && prevProps.value !== this.props.value) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({
        currentValue: this.props.value,
      });
    }
  };

  handleChange = (e: React.SyntheticEvent) => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      currentValue: e.target.value,
    });

    if (this.props.onChange) {
      this.props.onChange(e);
    }
  };

  handleFocus = (e: React.SyntheticEvent) => {
    this.setState({
      isFocused: true,
    });

    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: React.SyntheticEvent) => {
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

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
  blurYourself = () => (document.activeElement ? document.activeElement.blur() : null);
  blurOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.blurYourself();
    }
  };

  render() {
    const { isTextArea, onPressEnter, ...inputProps } = this.props;
    const InputClass = isTextArea ? Input.TextArea : Input;
    const defaultOnPressEnter = !isTextArea ? this.blurYourself : null;
    return (
      <InputClass
        {...inputProps}
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.currentValue}
        // @ts-expect-error ts-migrate(2322) FIXME: Type '((...args: any[]) => any) | null' is not ass... Remove this comment to see the full error message
        onPressEnter={onPressEnter != null ? onPressEnter : defaultOnPressEnter}
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(event: KeyboardEvent) => void' is not assig... Remove this comment to see the full error message
        onKeyDown={this.blurOnEscape}
      />
    );
  }
}

export default InputComponent;
