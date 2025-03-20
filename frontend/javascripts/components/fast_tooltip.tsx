import { generateRandomId } from "libs/utils";
import type React from "react";
import { useEffect, useState } from "react";
import { Tooltip as ReactTooltip } from "react-tooltip";

/*
 * This module provides a <FastTooltip /> component that should be preferred
 * over antd components because it is significantly faster.
 *
 * There are some major differences to the antd tooltip:
 * - Under the hood, react-tooltip is used which provides one (or a few) root
 *   tooltip component(s) that listen(s) to other (lightweight) trigger elements that
 *   want to show a tooltip. Since only one tooltip is usually shown at the same
 *   time, this significantly reduces the need for spawning tooltip components
 *   at runtime.
 * - The component always adds an additional HTML element (e.g., div or span)
 *   around the component that should get the tooltip on hover. Especially in
 *   combination with antd components, this can cause some slight issues, but
 *   usually it's possible to move the <FastTooltip /> a bit in the hierarchy
 *   to fix these.
 * - Dynamic rendering of the tooltip content is a bit different, because
 *   react-tooltip only accepts a string or html code for the lightweight
 *   trigger element. The library supports rendering JSX, but it has to be passed
 *   to the root tooltip. FastTooltip does this automatically when passing the
 *   dynamicRenderer prop. That prop is used once when the tooltip should be opened
 *   (instead of constantly as it is the case with antd tooltips).
 *   The communication to the root tooltip works via the global variable
 *   uniqueKeyToDynamicRenderer and a unique id that is created when the trigger
 *   element is mounted.
 */

const ROOT_TOOLTIP_IDS = {
  DEFAULT: "main-tooltip",
  DYNAMIC: "main-tooltip-dynamic",
} as const;

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

// See docstring above for context.
const uniqueKeyToDynamicRenderer: Record<string, () => React.ReactElement> = {};

export default function FastTooltip({
  title,
  children,
  placement,
  disabled,
  onMouseEnter,
  onMouseLeave,
  wrapper,
  html,
  className,
  style,
  variant,
  dynamicRenderer,
}: {
  title?: string | null | undefined;
  children?: React.ReactNode;
  placement?: FastTooltipPlacement;
  disabled?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  wrapper?: "div" | "span" | "p" | "tr"; // Any valid HTML tag, span by default.
  html?: string | null | undefined;
  className?: string; // class name attached to the wrapper
  style?: React.CSSProperties; // style attached to the wrapper
  variant?: "dark" | "light" | "success" | "warning" | "error" | "info";
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
      return ROOT_TOOLTIP_IDS.DYNAMIC;
    }
    if (disabled || (title == null && html == null)) return "";
    return ROOT_TOOLTIP_IDS.DEFAULT;
  };

  return (
    <Tag
      data-tooltip-id={getId()}
      data-tooltip-content={title}
      data-tooltip-place={placement || "top"}
      data-tooltip-html={html}
      data-unique-key={uniqueKeyForDynamic}
      data-tooltip-variant={variant}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={className}
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
      <ReactTooltip id={ROOT_TOOLTIP_IDS.DEFAULT} className="max-z-index" />
      <ReactTooltip
        id={ROOT_TOOLTIP_IDS.DYNAMIC}
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
