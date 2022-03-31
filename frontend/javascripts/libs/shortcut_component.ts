import * as React from "react";
import { InputKeyboard, InputKeyboardNoLoop } from "libs/input";
// This component provides a lightweight wrapper around the input library.
// It leverages reacts lifecycle hooks to allow rendering-sensitive activation of shortcuts.
type Props = {
  keys: string;
  onTrigger: () => any;
  supportLoop?: boolean;
  supportInputElements?: boolean;
};
export default class Shortcut extends React.Component<Props> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'keyboardNoLoop' has no initializer and i... Remove this comment to see the full error message
  keyboardNoLoop: InputKeyboardNoLoop | InputKeyboard;

  componentDidMount() {
    this.keyboardNoLoop = new (this.props.supportLoop ? InputKeyboard : InputKeyboardNoLoop)(
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ [x: string]: () => any; }' is ... Remove this comment to see the full error message
      {
        [this.props.keys]: this.props.onTrigger,
      },
      {
        supportInputElements: this.props.supportInputElements,
      },
    );
  }

  componentWillUnmount() {
    this.keyboardNoLoop.destroy();
  }

  render() {
    return null;
  }
}
