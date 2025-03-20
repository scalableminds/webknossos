import { LoadingOutlined } from "@ant-design/icons";
import { Button, type ButtonProps, ConfigProvider } from "antd";
import * as React from "react";
import FastTooltip from "./fast_tooltip";
const { useState, useEffect, useRef } = React;

export type AsyncButtonProps = Omit<ButtonProps, "onClick"> & {
  hideContentWhenLoading?: boolean;
  onClick: (event: React.MouseEvent) => Promise<any>;
};

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
export function AsyncIconButton(
  props: Omit<AsyncButtonProps, "icon"> & {
    icon: React.ReactElement<any>;
  },
) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  return React.cloneElement(isLoading ? <LoadingOutlined /> : props.icon, { ...props, onClick });
}
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
