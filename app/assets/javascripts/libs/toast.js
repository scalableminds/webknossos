// @flow
import React from "react";
import { notification, Icon } from "antd";

export type ToastStyleType = "info" | "warning" | "success" | "error";
export type MessageType = { success: string } | { error: string };
export type ToastConfigType = {
  sticky?: boolean,
  timeout?: number,
  key?: string,
};

const Toast = {
  messages(messages: Array<MessageType>): void {
    messages.forEach(singleMessage => {
      if (singleMessage.success != null) {
        this.success(singleMessage.success);
      }
      if (singleMessage.error != null) {
        this.error(singleMessage.error);
      }
    });
  },

  message(
    type: ToastStyleType,
    message: string,
    { sticky = false, timeout = 6000, key = message }: ToastConfigType,
  ): void {
    let toastMessage;
    if (message.match(/<html[^>]*>/)) {
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
    };

    if (type === "error") {
      toastConfig = Object.assign(toastConfig, {
        icon: <Icon type="cross-circle-o" className="alert-wiggle" style={{ color: "#a94442" }} />,
        style: {
          backgroundColor: "#f2dede",
          borderColor: "#ebccd1",
          color: "#a94442",
        },
      });
    }

    notification[type](toastConfig);
  },

  info(message: string, config: ToastConfigType = {}) {
    return this.message("info", message, config);
  },

  warning(message: string, config: ToastConfigType = {}) {
    return this.message("warning", message, config);
  },

  success(message: string = "Success :-)", config: ToastConfigType = {}) {
    return this.message("success", message, config);
  },

  error(message: string = "Error :-/", config: ToastConfigType = {}) {
    return this.message("error", message, config);
  },

  close(key: string) {
    notification.close(key);
  },
};

export default Toast;
