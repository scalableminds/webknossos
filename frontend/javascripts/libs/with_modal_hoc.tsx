import { App } from "antd";
import type React from "react";

/**
 * The modal API as returned by antd's App.useApp(). In contrast to the static
 * Modal.info/success/error/warning/confirm methods, this instance is aware of the
 * surrounding ConfigProvider and therefore picks up the WEBKNOSSOS theme.
 */
export type ModalApi = ReturnType<typeof App.useApp>["modal"];

export type WithModalProps = {
  modal: ModalApi;
};

/**
 * Higher-Order Component that provides the themed modal API to class components
 * (which cannot call App.useApp() themselves).
 *
 * @param WrappedComponent - The class component to enhance
 * @returns Enhanced component which receives the modal API as a prop
 */
export function withModal<TProps extends WithModalProps>(
  WrappedComponent: React.ComponentType<TProps>,
): React.ComponentType<Omit<TProps, keyof WithModalProps> & { ref?: unknown }> {
  const WithModalComponent = (props: Omit<TProps, keyof WithModalProps> & { ref?: unknown }) => {
    const { ref, ...restProps } = props;
    const { modal } = App.useApp();

    const enhancedProps = {
      ...restProps,
      modal,
    } as unknown as TProps;

    return <WrappedComponent {...enhancedProps} ref={ref} />;
  };

  return WithModalComponent;
}
