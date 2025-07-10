import { InputKeyboard, InputKeyboardNoLoop } from "libs/input";
import { useEffect } from "react";
// This component provides a lightweight wrapper around the input library.
// It leverages reacts lifecycle hooks to allow rendering-sensitive activation of shortcuts.
type Props = {
  keys: string;
  onTrigger: () => any;
  supportLoop?: boolean;
  supportInputElements?: boolean;
};
export default function Shortcut(props: Props) {
  useEffect(() => {
    const keyboard = new (props.supportLoop ? InputKeyboard : InputKeyboardNoLoop)(
      {
        [props.keys]: props.onTrigger,
      },
      {
        supportInputElements: props.supportInputElements,
      },
    );

    return () => {
      keyboard.destroy();
    };
  }, [props.keys, props.onTrigger, props.supportLoop, props.supportInputElements]);

  return null;
}
