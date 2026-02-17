import { useEffect } from "react";

function TabTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

export default TabTitle;
