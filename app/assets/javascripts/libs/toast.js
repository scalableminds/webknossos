// @flow
import React from "react";
import { notification, Icon, Collapse } from "antd";

const Panel = Collapse.Panel;

export type ToastStyleType = "info" | "warning" | "success" | "error";
export type MessageType = { success?: string, error?: string, chain?: string };
export type ToastConfigType = {
  sticky?: boolean,
  timeout?: number,
  key?: string,
};

const Toast = {
  messages(messages: Array<MessageType>): void {
    const errorChainObject = messages.find(msg => typeof msg.chain !== "undefined");
    const errorChainString: ?string = errorChainObject && errorChainObject.chain;
    messages.forEach(singleMessage => {
      if (singleMessage.success != null) {
        this.success(singleMessage.success);
      }
      if (singleMessage.error != null) {
        if (errorChainString) {
          this.renderDetailedErrorMessage(singleMessage.error, errorChainString);
        } else {
          this.error(singleMessage.error);
        }
      }
    });
  },

  renderDetailedErrorMessage(errorString: string, errorChain: string): void {
    this.error(
      <div>
        {errorString}
        <Collapse
          className="errorChainCollapse"
          bordered={false}
          style={{ background: "transparent", marginLeft: -16 }}
        >
          <Panel
            header="Show debug information"
            style={{ background: "transparent", border: 0, fontSize: 10 }}
          >
            {errorChain}
          </Panel>
        </Collapse>
      </div>,
      { sticky: true },
    );
  },

  message(
    type: ToastStyleType,
    message: string | React$Element<any>,
    config: ToastConfigType,
  ): void {
    const timeout = config.timeout || 6000;
    const key = config.key || (typeof message === "string" ? message : null);
    const sticky = config.sticky;
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

  error(message: string | React$Element<any> = "Error :-/", config: ToastConfigType = {}) {
    return this.message("error", message, config);
  },

  close(key: string) {
    notification.close(key);
  },
};

export default Toast;
