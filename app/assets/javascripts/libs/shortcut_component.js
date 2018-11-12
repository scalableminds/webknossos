// @flow
import * as React from "react";

import { InputKeyboard, InputKeyboardNoLoop } from "libs/input";

// This component provides a lightweight wrapper around the input library.
// It leverages reacts lifecycle hooks to allow rendering-sensitive activation of shortcuts.

type Props = {
  keys: string,
  onTrigger: () => *,
  supportLoop?: boolean,
  supportInputElements?: boolean,
};

export default class Shortcut extends React.Component<Props> {
  keyboardNoLoop: InputKeyboardNoLoop | InputKeyboard;

  componentDidMount() {
    this.keyboardNoLoop = new (this.props.supportLoop ? InputKeyboard : InputKeyboardNoLoop)(
      {
        [this.props.keys]: this.props.onTrigger,
      },
      { supportInputElements: this.props.supportInputElements },
    );
  }

  componentWillUnmount() {
    this.keyboardNoLoop.destroy();
  }

  render() {
    return null;
  }
}
