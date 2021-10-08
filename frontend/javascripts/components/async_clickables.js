// @flow
import { Button } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import * as React from "react";
const { useState, useEffect, useRef } = React;

type Props = {
  onClick: (SyntheticInputEvent<>) => Promise<any>,
  hideContentWhenLoading?: boolean,
  children?: React.Node,
};

function useLoadingClickHandler(originalOnClick: (SyntheticInputEvent<>) => Promise<any>) {
  const [isLoading, setIsLoading] = useState(false);
  const wasUnmounted = useRef(false);

  useEffect(
    () => () => {
      wasUnmounted.current = true;
    },
    [],
  );

  const onClick = async (event: SyntheticInputEvent<>) => {
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

export function AsyncButton(props: Props) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  const { children, hideContentWhenLoading, ...rest } = props;
  const effectiveChildren = hideContentWhenLoading && isLoading ? null : children;
  // eslint-disable-next-line react/no-children-prop
  return <Button {...rest} children={effectiveChildren} loading={isLoading} onClick={onClick} />;
}

export function AsyncIconButton(props: Props & { icon: React.Element<*> }) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  return React.cloneElement(isLoading ? <LoadingOutlined /> : props.icon, {
    onClick,
    ...props,
  });
}

export function AsyncLink(props: Props & { icon: React.Node }) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  const icon = isLoading ? <LoadingOutlined key="loading-icon" /> : props.icon;
  const content = [icon, props.children];
  return (
    <a {...props} onClick={onClick} className={isLoading ? "link-in-progress" : null}>
      {content}
    </a>
  );
}

export default {};
