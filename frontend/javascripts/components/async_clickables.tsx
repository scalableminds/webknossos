import { Button } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import * as React from "react";
const { useState, useEffect, useRef } = React;
type Props = {
  type?: string;
  icon?: React.ReactNode;
  href: string;
  onClick: (arg0: React.SyntheticEvent) => Promise<any>;
  hideContentWhenLoading?: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
};

function useLoadingClickHandler(originalOnClick: (arg0: React.SyntheticEvent) => Promise<any>) {
  const [isLoading, setIsLoading] = useState(false);
  const wasUnmounted = useRef(false);
  useEffect(
    () => () => {
      wasUnmounted.current = true;
    },
    [],
  );

  const onClick = async (event: React.SyntheticEvent) => {
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
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'boolean | ((event: SyntheticEvent<Element, E... Remove this comment to see the full error message
  // eslint-disable-next-line react/no-children-prop
  return <Button {...rest} children={effectiveChildren} loading={isLoading} onClick={onClick} />;
}
export function AsyncIconButton(
  props: Props & {
    icon: React.ReactElement<any>;
  },
) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  return React.cloneElement(isLoading ? <LoadingOutlined /> : props.icon, { ...props, onClick });
}
export function AsyncLink(
  props: Props & {
    icon: React.ReactNode;
  },
) {
  const [isLoading, onClick] = useLoadingClickHandler(props.onClick);
  const icon = isLoading ? <LoadingOutlined key="loading-icon" /> : props.icon;
  return (
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'boolean | ((event: SyntheticEvent<Element, E... Remove this comment to see the full error message
    <a {...props} onClick={onClick} className={isLoading ? "link-in-progress" : null}>
      {icon}
      {props.children}
    </a>
  );
}
export default {};
