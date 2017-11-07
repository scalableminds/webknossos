// @flow
import React from "react";
import { notification } from "antd";

export type ToastStyleType = "info" | "warning" | "success" | "error";

const Toast = {
  messages(messages: Array<{ success: string } | { error: string }>): void {
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
    sticky: boolean = false,
    timeout: number = 6,
  ): void {
    let toastMessage;
    if (message.match(/<html[^>]*>/)) {
      const src = `data:text/html;charset=utf-8,${escape(message)}`;
      toastMessage = <iframe src={src} title="toast-iframe" />;
    } else {
      toastMessage = message;
    }

    let toastConfig = {
      key: toastMessage,
      duration: sticky ? 0 : timeout,
      message: toastMessage,
      style: {},
      className: "",
    };

    if (type === "error") {
      toastConfig = Object.assign(toastConfig, {
        style: {
          backgroundColor: "#f2dede",
          borderColor: "#ebccd1",
          color: "#a94442",
        },
        className: "alert-wiggle",
      });
    }

    notification[type](toastConfig);
  },

  info(message: string, sticky?: boolean) {
    return this.message("info", message, sticky);
  },

  warning(message: string, sticky?: boolean) {
    return this.message("warning", message, sticky);
  },

  success(message: string = "Success :-)", sticky?: boolean) {
    return this.message("success", message, sticky);
  },

  error(message: string = "Error :-/", sticky?: boolean) {
    return this.message("error", message, sticky);
  },

  close(key: string) {
    notification.close(key);
  },
};

export default Toast;
