import { CloseCircleOutlined } from "@ant-design/icons";
import { Collapse, notification } from "antd";
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

  message(
    type: ToastStyle,
    rawMessage: string | React.ReactNode,
    config: ToastConfig,
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

    notification[type](toastConfig);
  },

  info(message: React.ReactNode, config: ToastConfig = {}, details?: string | undefined): void {
    this.message("info", message, config, details);
  },

  warning(message: React.ReactNode, config: ToastConfig = {}, details?: string | undefined): void {
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
    this.message("error", message, config, details);
  },

  close(key: string) {
    notification.destroy(key);
  },
};
export default Toast;
