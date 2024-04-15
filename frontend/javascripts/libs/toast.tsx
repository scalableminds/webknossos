import { notification, Collapse } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import React from "react";
import { useEffectOnlyOnce } from "./react_hooks";
import renderIndependently from "./render_independently";
import { animationFrame, sleep } from "./utils";

export type ToastStyle = "info" | "warning" | "success" | "error";
export type Message = {
  success?: string;
  error?: string;
  chain?: string;
  key?: string;
};

export type ToastConfig = {
  sticky?: boolean;
  timeout?: number;
  key?: string;
  onClose?: () => void;
};

export type NotificationAPI = ReturnType<typeof notification.useNotification>[0];
type ToastMessageCallback = (api: NotificationAPI) => React.ReactNode;

function ToastFunctionalComponentWrapper(props: {
  type: ToastStyle;
  message: (api: NotificationAPI) => React.ReactNode;
  config: ToastConfig;
  details: string | undefined;
}) {
  const [toastAPI, contextHolder] = notification.useNotification();
  useEffectOnlyOnce(() => {
    Toast._messageInternal(
      props.type,
      props.message(toastAPI),
      props.config,
      toastAPI,
      props.details,
    );
  });
  // Return empty renderable component for "renderIndependently"
  return <>{contextHolder}</>;
}

const Toast = {
  messages(messages: Message[]): void {
    const errorChainObject = messages.find((msg) => typeof msg.chain !== "undefined");
    const errorChainString: string | null | undefined = errorChainObject?.chain;
    messages.forEach((singleMessage) => {
      if (singleMessage.success != null) {
        this.success(singleMessage.success);
      }

      if (singleMessage.error != null) {
        this.error(
          singleMessage.error,
          {
            sticky: true,
            key: singleMessage.key,
          },
          errorChainString,
        );
      }
    });
  },

  buildContentWithDetails(
    title: string | React.ReactNode,
    details: string | React.ReactNode | null,
  ) {
    if (!details) {
      // This also handles empty title strings
      return title || "Unknown Error";
    }

    return (
      <div>
        {title}
        <Collapse
          className="collapsibleToastDetails"
          bordered={false}
          style={{
            background: "transparent",
            marginLeft: -16,
          }}
          items={[
            {
              key: "toast-panel",
              label: "Show more information",
              style: {
                background: "transparent",
                border: 0,
                fontSize: 10,
              },
              children: details,
            },
          ]}
        />
      </div>
    );
  },

  async _messageInternal(
    type: ToastStyle,
    rawMessage: string | React.ReactNode,
    config: ToastConfig,
    notificationAPI: NotificationAPI,
    details?: string,
  ): Promise<void> {
    const message = this.buildContentWithDetails(rawMessage, details);
    const timeout = config.timeout != null ? config.timeout : 6000;
    const key = config.key || (typeof message === "string" ? message : undefined);
    const { sticky, onClose } = config;
    let toastMessage;

    if (typeof message === "string" && message.match(/<html[^>]*>/)) {
      const src = `data:text/html;charset=utf-8,${escape(message)}`;
      toastMessage = <iframe src={src} title="toast-iframe" />;
    } else {
      toastMessage = message;
    }

    let toastConfig = {
      icon: undefined,
      key,
      duration: 0,
      message: toastMessage,
      style: {},
      className: "",
      onClose,
    };

    if (type === "error") {
      toastConfig = Object.assign(toastConfig, {
        icon: <CloseCircleOutlined />,
      });
    }

    notificationAPI[type](toastConfig);

    // Make sure that toasts don't just disappear while the user has WK in a background tab (e.g. while uploading large dataset).
    // Most browsers pause requestAnimationFrame() if the current tab is not active, but Firefox does not seem to do that.
    if (!sticky && key != null) {
      const splitTimeout = timeout / 2;
      await animationFrame(); // ensure tab is active
      await sleep(splitTimeout);
      await animationFrame();
      // If the user has switched the tab, show the toast again so that the user doesn't just see the toast dissapear.
      await sleep(splitTimeout);
      this.close(key);
    }
  },

  info(message: React.ReactNode, config: ToastConfig = {}, details?: string | undefined): void {
    this.message("info", message, config, details);
  },

  warning(message: React.ReactNode, config: ToastConfig = {}, details?: string | undefined): void {
    if (typeof message === "string") console.warn(message);
    this.message("warning", message, config, details);
  },

  success(
    message: React.ReactNode = "Success :-)",
    config: ToastConfig = {},
    details?: string | undefined,
  ): void {
    this.message("success", message, config, details);
  },

  error(
    message: React.ReactNode = "Error :-/",
    config: ToastConfig = {},
    details?: string | undefined,
  ): void {
    if (typeof message === "string") console.error(message);
    this.message("error", message, config, details);
  },

  close(key: string) {
    notification.destroy(key);
  },
  message(
    type: ToastStyle,
    message: ToastMessageCallback | React.ReactNode = "Success :-)",
    config: ToastConfig = {},
    details?: string | undefined,
  ) {
    renderIndependently((destroy) => {
      // Deferring destroy to give the Notification API a chance to close the toast via timeout
      // before unmounting the parent component created with renderIndependently.
      const deferredDestroy = () => setTimeout(destroy, 0);
      const userOnClose = config.onClose;
      // Making sure onClose destroys the ToastFunctionalComponentWrapper instance.
      config.onClose =
        userOnClose != null
          ? () => {
              userOnClose();
              deferredDestroy();
            }
          : () => {
              deferredDestroy();
            };
      const maybeWrappedMessage = (
        typeof message === "function" ? message : () => message
      ) as ToastMessageCallback;
      return (
        <ToastFunctionalComponentWrapper
          message={maybeWrappedMessage}
          config={config}
          details={details}
          type={type}
        />
      );
    });
  },
};
export default Toast;
