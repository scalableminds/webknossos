import { InputKeyboard, InputKeyboardNoLoop } from "libs/input";
import { useEffect } from "react";

// This component provides a lightweight wrapper around the input library.
// It leverages reacts lifecycle hooks to allow rendering-sensitive activation of shortcuts.
// TODOM maybe replace with new keystrokes hooks
type Props = {
  keys: string;
  onTrigger: () => any;
  supportLoop?: boolean;
  supportInputElements?: boolean;
};
export default function Shortcut({ keys, onTrigger, supportLoop, supportInputElements }: Props) {
  useEffect(() => {
    const keyboard = supportLoop
      ? new InputKeyboard({ [keys]: { onPressedWithRepeat: onTrigger } }, { supportInputElements })
      : new InputKeyboardNoLoop({ [keys]: { onPressed: onTrigger } }, { supportInputElements });

    return () => {
      keyboard.destroy();
    };
  }, [keys, onTrigger, supportLoop, supportInputElements]);

  return null;
}
