import { Button } from "antd";
import { useEffect, useState } from "react";

export function UndoButton({ onUndo, seconds }: { onUndo: () => void; seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => r - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return <Button onClick={onUndo}>Undo ({remaining})</Button>;
}
