import { ConfigProvider } from "antd";
import React, { Fragment, useEffect } from "react";
import { ContextMenuContext } from "./context_menu";

export function GenericContextMenuContainer(props: {
  contextMenuPosition: Readonly<[number, number]> | null | undefined;
  hideContextMenu: () => void;
  children: React.ReactElement;
  positionAbsolute?: boolean;
  className?: string;
}) {
  /*
   * This container for the context menu is *always* rendered.
   * An input ref is stored for the actual container which is
   * passed to antd <Dropdown /> so that it renders the actual
   * menu into that container when desired.
   * When <Dropdown /> is not used to render the menu, antd assumes
   * that the <Menu /> is a navigational menu. Navigational menus
   * behave differently (predominantly, their styling uses way more
   * padding and entries are rendered as links). In earlier implementations
   * of the context menu, we simply overrode those styles. However, at the
   * latest when sub menus are used, the styling issues become too complicated
   * to deal with.
   */
  const inputRef: React.MutableRefObject<HTMLElement | null> = React.useRef(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Always focus newest input ref
  useEffect(() => {
    if (inputRef.current != null) {
      inputRef.current.focus();
    }
  }, [inputRef.current]);
  const { contextMenuPosition, hideContextMenu } = props;
  return (
    <Fragment>
      <div
        className={`node-context-menu-overlay ${props.className || ""}`}
        onClick={hideContextMenu}
        onContextMenu={(evt) => {
          evt.preventDefault();
          hideContextMenu();
        }}
        style={{
          display: contextMenuPosition == null ? "none" : "inherit",
        }}
      />
      {/*
         This div serves as a "prison" for the sticky context menu. The above div
         cannot be used since the context menu would then be closed on every click.
         Since both divs are absolutely positioned and cover the whole page,
         avoid blocking click events by temporarily disabling them for this "prison"
         div.
        */}
      <div
        className={`node-context-menu-overlay ${props.className || ""}`}
        style={{
          pointerEvents: "none",
          display: contextMenuPosition == null ? "none" : "inherit",
        }}
      >
        <div
          style={{
            position: props.positionAbsolute ? "absolute" : "sticky",
            left: contextMenuPosition != null ? contextMenuPosition[0] : 0,
            top: contextMenuPosition != null ? contextMenuPosition[1] : 0,
            width: "fit-content",
            height: "fit-content",
            pointerEvents: "all",
          }}
          className="node-context-menu"
          tabIndex={-1}
          // @ts-expect-error
          ref={inputRef}
        />
        {/* Disable animations for the context menu (for performance reasons). */}
        <ConfigProvider theme={{ token: { motion: false } }}>
          <ContextMenuContext.Provider value={inputRef}>
            {props.children}
          </ContextMenuContext.Provider>
        </ConfigProvider>
      </div>
    </Fragment>
  );
}
