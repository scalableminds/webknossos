import { InputKeyboard } from "libs/input";
import { useEffect } from "react";

// This component provides a lightweight wrapper around the input library.
// It leverages reacts lifecycle hooks to allow rendering-sensitive activation of shortcuts.
type Props = {
  keys: string;
  onTrigger: () => any;
  supportLoop?: boolean;
  supportInputElements?: boolean;
};
export default function Shortcut({ keys, onTrigger, supportLoop, supportInputElements }: Props) {
  useEffect(() => {
    const handler = supportLoop ? { onPressedWithRepeat: onTrigger } : { onPressed: onTrigger };
    const keyboard = new InputKeyboard({ [keys]: handler }, { supportInputElements });

    return () => {
      keyboard.destroy();
    };
  }, [keys, onTrigger, supportLoop, supportInputElements]);

  return null;
}
