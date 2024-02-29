import { Input, InputProps, InputRef, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";

type InputComponentState = {
  currentValue: React.InputHTMLAttributes<HTMLInputElement>["value"] | BigInt;
};

/*
 * A lightweight wrapper around <Input> which:
 * - automatically blurs on Escape
 * - fixes cursor-jumping bugs by keeping a local copy of the input's value
 *   within state.currentValue. Without it, editing the name of trees or
 *   comments would always move the cursor to the input's end after each key press.
 *   The fix is inspired by https://github.com/facebook/react/issues/955#issuecomment-281802381
 * - maintains the cursor position / selection even when mutating the input value
 *   while it's focused (mainly necessary when mutating the value on arrow-keypresses)
 */

class InputComponent extends React.PureComponent<InputProps, InputComponentState> {
  inputRef = React.createRef<InputRef>();
  static defaultProps: InputProps = {
    onChange: _.noop,
    placeholder: "",
    value: "",
    style: {},
  };

  state = {
    currentValue: this.props.value,
  };

  getSnapshotBeforeUpdate(_prevProps: InputProps, _prevState: {}): [number | null, number | null] {
    // Remember the selection within the input before updating it.
    try {
      return [
        // @ts-ignore
        this.inputRef?.current?.input.selectionStart,
        // @ts-ignore
        this.inputRef?.current?.input.selectionEnd,
      ];
    } catch {
      return [null, null];
    }
  }

  componentDidUpdate(
    prevProps: InputProps,
    _prevState: {},
    snapshot: [number | null, number | null],
  ) {
    if (prevProps.value !== this.props.value) {
      this.setState({
        currentValue: this.props.value,
      });
    }

    if (this.inputRef.current && document.activeElement !== this.inputRef.current.input) {
      // Don't mutate the selection if the element is not active. Otherwise,
      // the on-screen keyboard opens on iOS when moving through the dataset.
      return;
    }

    // Restore the remembered selection when necessary
    try {
      // @ts-ignore
      this.inputRef.current.input.selectionStart = snapshot[0];
      // @ts-ignore
      this.inputRef.current.input.selectionEnd = snapshot[1];
    } catch {}
  }

  handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      currentValue: e.target.value,
    });
    if (this.props.onChange) {
      this.props.onChange(e);
    }
  };

  handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (this.props.onBlur) {
      this.props.onBlur(e);
    }
  };

  blurYourself = () =>
    document.activeElement ? (document.activeElement as HTMLElement).blur() : null;

  blurOnEscape = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.blurYourself();
    }
    if (this.props.onKeyDown) {
      return this.props.onKeyDown(event);
    }
  };

  render() {
    const { title, style, ...inputProps } = this.props;
    const input = (
      <Input
        ref={this.inputRef}
        {...inputProps}
        style={title == null ? style : undefined}
        onChange={this.handleChange}
        onFocus={this.handleFocus}
        onBlur={this.handleBlur}
        value={this.state.currentValue}
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
