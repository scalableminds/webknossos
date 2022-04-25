import { Input, InputProps, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";
import TextArea, { TextAreaProps } from "antd/lib/input/TextArea";

export type InputComponentProps = InputProps &
  TextAreaProps & {
    title?: React.ReactNode;
    isTextArea?: boolean;
  };

type InputComponentState = {
  isFocused: boolean;
  currentValue: React.InputHTMLAttributes<HTMLInputElement>["value"];
}; // TODO Double check if we still need this once React v16 is released.

/*
 * A lightweight wrapper around <Input> to deal with a "jumping cursor" bug.
 * Modifying a input's value will always reset the cursor to the end even if
 * you are editing the middle of a string. Saving the input's value in state
 * remedies this. Rumors claim React v16 will fix this.
 * Inspired by https://github.com/facebook/react/issues/955#issuecomment-281802381
 * @class
 */

class InputComponent extends React.PureComponent<InputComponentProps, InputComponentState> {
  static defaultProps: InputComponentProps = {
    onChange: _.noop,
    onFocus: _.noop,
    onBlur: _.noop,
    onPressEnter: undefined,
    placeholder: "",
    value: "",
    style: {},
    isTextArea: false,
  };

  state = {
    isFocused: false,
    currentValue: this.props.value,
  };

  componentDidUpdate(prevProps: InputComponentProps) {
    if (!this.state.isFocused && prevProps.value !== this.props.value) {
      this.setState({
        currentValue: this.props.value,
      });
    }
  }

  handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    this.setState({
      currentValue: e.target.value,
    });

    if (this.props.onChange) {
      // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
      this.props.onChange(e);
    }
  };

  handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    this.setState({
      isFocused: true,
    });

    if (this.props.onFocus) {
      // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    this.setState(
      {
        isFocused: false,
      },
      () => {
        if (this.props.onBlur) {
          // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
          this.props.onBlur(e);
        }
      },
    );
  };

  blurYourself = () =>
    document.activeElement ? (document.activeElement as HTMLElement).blur() : null;
  blurOnEscape = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.blurYourself();
    }
  };

  render() {
    const { isTextArea, onPressEnter, title, style, ...inputProps } = this.props;
    let input;
    if (isTextArea) {
      input = (
        <TextArea
          {...inputProps}
          style={title == null ? style : undefined}
          onChange={this.handleChange}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
          value={this.state.currentValue}
          onPressEnter={onPressEnter != null ? onPressEnter : undefined}
          onKeyDown={this.blurOnEscape}
        />
      );
    } else {
      input = (
        <Input
          {...inputProps}
          style={title == null ? style : undefined}
          onChange={this.handleChange}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
          value={this.state.currentValue}
          onPressEnter={onPressEnter != null ? onPressEnter : this.blurYourself}
          onKeyDown={this.blurOnEscape}
        />
      );
    }
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
