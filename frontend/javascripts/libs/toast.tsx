import { notification, Collapse } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import React from "react";

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

const Toast = {
  messages(
    messages: Message[],
    notificationAPI?: ReturnType<typeof notification.useNotification>[0],
  ): void {
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
          notificationAPI,
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

  message(
    type: ToastStyle,
    rawMessage: string | React.ReactNode,
    config: ToastConfig,
    notificationAPI?: ReturnType<typeof notification.useNotification>[0],
    details?: string,
  ): void {
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

    const timeOutInSeconds = timeout / 1000;
    let toastConfig = {
      icon: undefined,
      key,
      duration: sticky ? 0 : timeOutInSeconds,
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
    if (notificationAPI) {
      notificationAPI[type](toastConfig);
    } else {
      notification[type](toastConfig);
    }
  },

  info(
    message: React.ReactNode,
    config: ToastConfig = {},

    toastAPI?: ReturnType<typeof notification.useNotification>[0],
    details?: string | undefined,
  ): void {
    this.message("info", message, config, toastAPI, details);
  },

  warning(
    message: React.ReactNode,
    config: ToastConfig = {},
    toastAPI?: ReturnType<typeof notification.useNotification>[0],

    details?: string | undefined,
  ): void {
    this.message("warning", message, config, toastAPI, details);
  },

  success(
    message: React.ReactNode = "Success :-)",
    config: ToastConfig = {},
    toastAPI?: ReturnType<typeof notification.useNotification>[0],
    details?: string | undefined,
  ): void {
    this.message("success", message, config, toastAPI, details);
  },

  error(
    message: React.ReactNode = "Error :-/",
    config: ToastConfig = {},
    toastAPI?: ReturnType<typeof notification.useNotification>[0],
    details?: string | undefined,
  ): void {
    this.message("error", message, config, toastAPI, details);
  },

  close(key: string) {
    notification.destroy(key);
  },
  useToastAPI() {
    // This method returns a [toastAPI, contextHolder] in case a toast should be rendered independently
    // from outside the usual rendering hierarchy via e.g. renderIndependently.
    // In such a case the toastAPI needs to be provided to the Toast.<method> call and the context holder needs
    // to be rendered as within the new independent component hierarchy. For more info look for uses of `useToastAPI`.
    return notification.useNotification();
  },
};
export default Toast;
