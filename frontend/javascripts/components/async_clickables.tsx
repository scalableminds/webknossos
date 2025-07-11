import { LoadingOutlined } from "@ant-design/icons";
import { Button, type ButtonProps, ConfigProvider } from "antd";
import * as React from "react";
import FastTooltip from "./fast_tooltip";
const { useState, useEffect, useRef } = React;

/**
 * Props for the AsyncButton component.
 */
export type AsyncButtonProps = Omit<ButtonProps, "onClick"> & {
  /**
   * If true, the button's content will be hidden when it is in the loading state.
   */
  hideContentWhenLoading?: boolean;
  /**
   * The async function to be called when the button is clicked.
   * It should return a promise that resolves when the async operation is complete.
   */
  onClick: (event: React.MouseEvent) => Promise<any>;
};

/**
 * A React hook that wraps an async onClick handler to manage a loading state.
 * @param originalOnClick The async function to be called when the element is clicked.
 * @returns A tuple containing a boolean `isLoading` state and the wrapped `onClick` handler.
 */
function useLoadingClickHandler(
  originalOnClick: (event: React.MouseEvent) => Promise<any>,
): [boolean, React.MouseEventHandler] {
  const [isLoading, setIsLoading] = useState(false);
  const wasUnmounted = useRef(false);
  useEffect(
    () => () => {
      wasUnmounted.current = true;
    },
    [],
  );

  const onClick = async (event: React.MouseEvent) => {
    if (isLoading) {
      // Ignoring the event when a previous event is still being processed.
      return;
    }

    setIsLoading(true);

    try {
      await originalOnClick(event);
    } finally {
      if (!wasUnmounted.current) {
        setIsLoading(false);
      }
    }
  };

  return [isLoading, onClick];
}

/**
 * A button component that handles asynchronous actions.
 * It displays a loading indicator while the `onClick` promise is pending.
 * It is a wrapper around the antd Button component.
 */
export function AsyncButton(props: AsyncButtonProps) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  const { children, hideContentWhenLoading, title, ...rest } = props;
  const effectiveChildren = hideContentWhenLoading && isLoading ? null : children;
  return (
    <FastTooltip title={title}>
      {/* Avoid weird animation when icons swap */}
      <ConfigProvider theme={{ token: { motion: false } }}>
        <Button {...rest} loading={isLoading} onClick={onClick}>
          {effectiveChildren}
        </Button>
      </ConfigProvider>
    </FastTooltip>
  );
}

/**
 * An icon button component that handles asynchronous actions.
 * It displays a loading indicator in place of the icon while the `onClick` promise is pending.
 */
export function AsyncIconButton(
  props: Omit<AsyncButtonProps, "icon"> & {
    /** The icon to be displayed on the button. */
    icon: React.ReactElement<any>;
  },
) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  return React.cloneElement(isLoading ? <LoadingOutlined /> : props.icon, { ...props, onClick });
}

/**
 * A link component that handles asynchronous actions.
 * It displays a loading indicator before the link text while the `onClick` promise is pending.
 */
export function AsyncLink(props: AsyncButtonProps) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  const icon = isLoading ? (
    <LoadingOutlined key="loading-icon" className="icon-margin-right" />
  ) : (
    props.icon
  );
  return (
    <a
      {...props}
      onClick={props.disabled ? undefined : onClick}
      className={isLoading ? "link-in-progress" : undefined}
    >
      {icon}
      {props.children}
    </a>
  );
}
export default {};
