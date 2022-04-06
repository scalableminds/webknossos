// @flow

import { Input, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";

type InputComponentProp = {
  onChange?: Function,
  onFocus?: Function,
  onBlur?: Function,
  onPressEnter?: Function,
  placeholder?: string,
  value: string,
  style?: any,
  isTextArea?: boolean,
  title?: ?React.Node,
};

type InputComponentState = {
  isFocused: boolean,
  currentValue: string,
};

// TODO Double check if we still need this once React v16 is released.

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
      this.setState({ currentValue: this.props.value });
    }
  };

  handleChange = (e: SyntheticInputEvent<>) => {
    this.setState({ currentValue: e.target.value });
    if (this.props.onChange) {
      this.props.onChange(e);
    }
  };

  handleFocus = (e: SyntheticInputEvent<>) => {
    this.setState({ isFocused: true });
    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: SyntheticInputEvent<>) => {
    this.setState({ isFocused: false }, () => {
      if (this.props.onBlur) {
        this.props.onBlur(e);
      }
    });
  };

  blurYourself = () => (document.activeElement ? document.activeElement.blur() : null);

  blurOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.blurYourself();
    }
  };

  render() {
    const { isTextArea, onPressEnter, title, style, ...inputProps } = this.props;
    const InputClass = isTextArea ? Input.TextArea : Input;
    const defaultOnPressEnter = !isTextArea ? this.blurYourself : null;
    const input = (
      <InputClass
        {...inputProps}
        style={title == null ? style : null}
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.currentValue}
        onPressEnter={onPressEnter != null ? onPressEnter : defaultOnPressEnter}
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
