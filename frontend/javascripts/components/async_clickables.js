// @flow
import { Button } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import * as React from "react";
const { useState, useEffect, useRef } = React;

type Props = {
  onClick: (SyntheticInputEvent<>) => Promise<any>,
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
  return <Button {...props} loading={isLoading} onClick={onClick} />;
}

export function AsyncIconButton(allProps: Props & { icon: React.Node }) {
  const { icon, ...props } = allProps;
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  return (
    <React.Fragment onClick={onClick}> {isLoading ? <LoadingOutlined /> : icon}</React.Fragment>
  );
}

export function AsyncLink(props: Props & { children: React.Node }) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  let content;
  if (isLoading) {
    const children = React.Children.toArray(props.children);
    const childrenWithoutIcon = children.filter(child => {
      if (child.type == null) {
        return true;
      }
      return child.type !== "i" && child.type.name !== "Icon";
    });
    content = [<LoadingOutlined key="loading-icon" />, childrenWithoutIcon];
  } else {
    content = props.children;
  }

  return (
    <a {...props} onClick={onClick} className={isLoading ? "link-in-progress" : null}>
      {content}
    </a>
  );
}

export default {};
