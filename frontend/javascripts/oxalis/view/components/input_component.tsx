import { Input, InputProps, InputRef, Tooltip } from "antd";
import * as React from "react";
import _ from "lodash";

/*
 * A lightweight wrapper around <Input> which does:
 * - automatically blur on Escape
 * - maintain the cursor position / selection even when mutating the the input value
 *   while it's focused (mainly necessary when mutating the value on arrow-keypresses)
 */

class InputComponent extends React.PureComponent<InputProps, {}> {
  inputRef = React.createRef<InputRef>();
  static defaultProps: InputProps = {
    onChange: _.noop,
    placeholder: "",
    value: "",
    style: {},
  };

  getSnapshotBeforeUpdate(_prevProps: InputProps, _prevState: {}): [number | null, number | null] {
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
    _prevProps: InputProps,
    _prevState: {},
    snapshot: [number | null, number | null],
  ) {
    try {
      // @ts-ignore
      this.inputRef.current.input.selectionStart = snapshot[0];
      // @ts-ignore
      this.inputRef.current.input.selectionEnd = snapshot[1];
    } catch {}
  }

  handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (this.props.onChange) {
      this.props.onChange(e);
    }
  };

  handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    this.setState({
      isFocused: true,
    });

    if (this.props.onFocus) {
      this.props.onFocus(e);
    }
  };

  handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
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
        value={this.props.value}
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
