// @flow
import { notification, Collapse } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import React from "react";

const { Panel } = Collapse;

export type ToastStyle = "info" | "warning" | "success" | "error";
export type Message = { success?: string, error?: string, chain?: string, key?: string };
export type ToastConfig = {
  sticky?: boolean,
  timeout?: number,
  key?: string,
  onClose?: () => void,
};

const Toast = {
  messages(messages: Array<Message>): void {
    const errorChainObject = messages.find(msg => typeof msg.chain !== "undefined");
    const errorChainString: ?string = errorChainObject && errorChainObject.chain;
    messages.forEach(singleMessage => {
      if (singleMessage.success != null) {
        this.success(singleMessage.success);
      }
      if (singleMessage.error != null) {
        this.error(singleMessage.error, { sticky: true, key: singleMessage.key }, errorChainString);
      }
    });
  },

  buildContentWithDetails(
    title: string | React$Element<any>,
    details: string | React$Element<any> | null,
  ) {
    if (!details) {
      return title;
    }
    return (
      <div>
        {title}
        <Collapse
          className="collapsibleToastDetails"
          bordered={false}
          style={{ background: "transparent", marginLeft: -16 }}
        >
          <Panel
            header="Show more information"
            style={{ background: "transparent", border: 0, fontSize: 10 }}
          >
            {details}
          </Panel>
        </Collapse>
      </div>
    );
  },

  message(
    type: ToastStyle,
    rawMessage: string | React$Element<any>,
    config: ToastConfig,
    details?: string,
  ): void {
    const message = this.buildContentWithDetails(rawMessage, details);

    const timeout = config.timeout != null ? config.timeout : 6000;
    const key = config.key || (typeof message === "string" ? message : null);
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
        icon: <CloseCircleOutlined className="alert-wiggle" style={{ color: "#a94442" }} />,
        style: {
          backgroundColor: "#f2dede",
          borderColor: "#ebccd1",
          color: "#a94442",
        },
      });
    }

    notification[type](toastConfig);
  },

  info(message: string | React$Element<any>, config: ToastConfig = {}, details?: ?string): void {
    return this.message("info", message, config, details);
  },

  warning(message: string, config: ToastConfig = {}, details?: ?string): void {
    return this.message("warning", message, config, details);
  },

  success(message: string = "Success :-)", config: ToastConfig = {}, details?: ?string): void {
    return this.message("success", message, config, details);
  },

  error(
    message: string | React$Element<any> = "Error :-/",
    config: ToastConfig = {},
    details?: ?string,
  ): void {
    return this.message("error", message, config, details);
  },

  close(key: string) {
    notification.close(key);
  },
};

export default Toast;
