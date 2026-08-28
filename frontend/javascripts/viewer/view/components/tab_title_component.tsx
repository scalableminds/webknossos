import { useEffect } from "react";

function TabTitle({ title }: { title: string }) {
  useEffect(() => {
    const oldTitle = document.title;
    document.title = title;
    return () => {
      document.title = oldTitle;
    };
  }, [title]);

  return null;
}

export default TabTitle;
