import { useLayoutEffect, useState } from "react";

/*
 * Reports how much vertical space is left for the body of the table inside of the container.
 * antd's virtual table needs an explicit pixel height and cannot simply fill its parent.
 */
export function useTableBodyHeight() {
  // Held in state instead of a ref object, so that the measuring starts once the container appears.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useLayoutEffect(() => {
    if (container == null) {
      return;
    }
    const measure = () => {
      const headerHeight = container.querySelector(".ant-table-header")?.clientHeight ?? 0;
      setBodyHeight(Math.max(0, container.clientHeight - headerHeight));
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [container]);

  return { containerRef: setContainer, bodyHeight };
}
