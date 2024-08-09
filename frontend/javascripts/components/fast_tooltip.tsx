import { generateRandomId } from "libs/utils";
import React, { useEffect, useState } from "react";
import { Tooltip as ReactTooltip } from "react-tooltip";

export type FastTooltipPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "right"
  | "right-start"
  | "right-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end";

const uniqueKeyToDynamicRenderer: Record<string, () => React.ReactElement> = {};

export default function FastTooltip({
  title,
  children,
  placement,
  disabled,
  id,
  onMouseEnter,
  onMouseLeave,
  wrapper,
  html,
  style,
  dynamicRenderer,
}: {
  title?: string | null | undefined;
  children?: React.ReactNode;
  placement?: FastTooltipPlacement;
  disabled?: boolean;
  id?: string; // todop: remove?
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  wrapper?: "div" | "span" | "p" | "tr"; // Any valid HTML tag, span by default.
  html?: string | null | undefined;
  style?: React.CSSProperties; // style attached to the wrapper
  dynamicRenderer?: () => React.ReactElement;
}) {
  const Tag = wrapper || "span";
  const [uniqueKeyForDynamic, setUniqueDynamicId] = useState<string | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new unique id should only be created on mount
  useEffect(() => {
    if (!dynamicRenderer) {
      return;
    }
    const uniqueKey = generateRandomId(16);
    uniqueKeyToDynamicRenderer[uniqueKey] = dynamicRenderer;
    setUniqueDynamicId(uniqueKey);
    return () => {
      if (uniqueKeyForDynamic) {
        delete uniqueKeyToDynamicRenderer[uniqueKeyForDynamic];
      }
    };
  }, []);

  const getId = () => {
    if (uniqueKeyForDynamic != null) {
      return "main-tooltip-dynamic";
    }
    if (disabled || (title == null && html == null)) return "";
    return id || "main-tooltip";
  };

  return (
    <Tag
      data-tooltip-id={getId()}
      data-tooltip-content={title}
      data-tooltip-place={placement || "top"}
      data-tooltip-html={html}
      data-unique-key={uniqueKeyForDynamic}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function RootForFastTooltips() {
  // By default, ReactTooltip remembers the last hovered element and doesn't
  // recompute the tooltip content when hovering over the same element again.
  // However, this can mean that the tooltip shows outdated data. As a workaround
  // we disable the dynamic render function when the tooltip is not opened.
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <ReactTooltip id="main-tooltip" className="max-z-index" />
      <ReactTooltip
        id="main-tooltip-dynamic"
        className="max-z-index"
        setIsOpen={setIsOpen}
        render={
          !isOpen
            ? undefined
            : ({ activeAnchor }) => {
                const uniqueKey = activeAnchor?.getAttribute("data-unique-key");
                if (!uniqueKey) {
                  return null;
                }
                const fn = uniqueKeyToDynamicRenderer[uniqueKey];
                return fn != null ? fn() : null;
              }
        }
      />
    </>
  );
}
