import { notification, Collapse } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import React from "react";
import { useEffectOnlyOnce } from "./react_hooks";
import renderIndependently from "./render_independently";

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
  useEffectOnlyOnce(() =>
    Toast.message(props.type, props.message(toastAPI), props.config, toastAPI, props.details),
  );
  // Return empty renderable component for "renderIndependently"
  return <>{contextHolder}</>;
}

const Toast = {
  messages(messages: Message[], renderOutsideOfComponentHiearchy: boolean = false): void {
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
          renderOutsideOfComponentHiearchy,
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
    notificationAPI?: NotificationAPI | null,
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
    renderOutsideOfComponentHiearchy: boolean = false,
    details?: string | undefined,
  ): void {
    if (renderOutsideOfComponentHiearchy) {
      this.showOutsideComponentContext("info", message, config, details);
    } else {
      this.message("info", message, config, null, details);
    }
  },

  warning(
    message: React.ReactNode,
    config: ToastConfig = {},
    renderOutsideOfComponentHiearchy: boolean = false,
    details?: string | undefined,
  ): void {
    if (renderOutsideOfComponentHiearchy) {
      this.showOutsideComponentContext("warning", message, config, details);
    } else {
      this.message("warning", message, config, null, details);
    }
  },

  success(
    message: React.ReactNode = "Success :-)",
    config: ToastConfig = {},
    renderOutsideOfComponentHiearchy: boolean = false,
    details?: string | undefined,
  ): void {
    if (renderOutsideOfComponentHiearchy) {
      this.showOutsideComponentContext("success", message, config, details);
    } else {
      this.message("success", message, config, null, details);
    }
  },

  error(
    message: React.ReactNode = "Error :-/",
    config: ToastConfig = {},
    renderOutsideOfComponentHiearchy: boolean = false,
    details?: string | undefined,
  ): void {
    if (renderOutsideOfComponentHiearchy) {
      this.showOutsideComponentContext("error", message, config, details);
    } else {
      this.message("error", message, config, null, details);
    }
  },

  close(key: string) {
    notification.destroy(key);
  },
  showOutsideComponentContext(
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
