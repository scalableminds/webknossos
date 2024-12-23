import { notification, Collapse } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import type React from "react";
import { useEffect } from "react";
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

export function ToastContextMountRoot() {
  const [toastAPI, contextHolder] = notification.useNotification();
  useEffect(() => {
    Toast.notificationAPI = toastAPI;
  }, [toastAPI]);
  return <>{contextHolder}</>;
}

type ToastParams = {
  type: ToastStyle;
  message: React.ReactNode;
  config: ToastConfig;
  details?: string;
};

export async function guardedWithErrorToast(fn: () => Promise<any>) {
  try {
    await fn();
  } catch (error) {
    import("libs/error_handling").then((_ErrorHandling) => {
      const ErrorHandling = _ErrorHandling.default;
      Toast.error("An unexpected error occurred. Please check the console for details");
      console.error(error);
      ErrorHandling.notify(error as Error);
    });
  }
}

const Toast = {
  // The notificationAPI is designed to be a singleton spawned by the ToastContextMountRoot
  // mounted in the GlobalThemeProvider.
  // Once the notificationAPI is fully initialized, it is stored in this.notificationAPI.
  // undefined means that the notificationAPI is not yet initialized.
  notificationAPI: undefined as NotificationAPI | undefined,
  // Stores the pending toast messages before the notificationAPI is initialized.
  pendingToasts: [] as ToastParams[],
  // Stores the pending manual timeouts for toasts to avoid multiple timeouts for the same toast.
  closePendingToastsEarlyMap: {} as Record<string, () => void>,
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

  _messageInternal(
    type: ToastStyle,
    rawMessage: string | React.ReactNode,
    config: ToastConfig,
    details?: string,
  ) {
    if (!this.notificationAPI) {
      return;
    }
    const localNotificationAPI = this.notificationAPI;
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
    const useManualTimeout = !sticky && key != null;
    let toastConfig = {
      icon: undefined,
      key,
      duration: useManualTimeout || sticky ? 0 : timeOutInSeconds,
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

    // Make sure that toasts don't just disappear while the user has WK in a background tab (e.g. while uploading large dataset).
    // Most browsers pause requestAnimationFrame() if the current tab is not active, but Firefox does not seem to do that.
    if (useManualTimeout) {
      // In case a toast with the same key is already open, close it first.
      this.closePendingToastsEarlyMap[key]?.();
      let cancelledTimeout = false;
      const timeoutToastManually = async () => {
        const splitTimeout = timeout / 2;
        await animationFrame(); // ensure tab is active
        await sleep(splitTimeout);
        await animationFrame();
        // If the user has switched the tab, show the toast again so that the user doesn't just see the toast disappear.
        await sleep(splitTimeout);
        if (cancelledTimeout) {
          // If the toast has been closed early, don't close it again.
          return;
        }
        this.close(key);
        delete this.closePendingToastsEarlyMap[key];
      };
      // Start the toast timeout and store the cancel function.
      timeoutToastManually();
      const closeToastEarly = () => {
        this.close(key);
        cancelledTimeout = true;
        delete this.closePendingToastsEarlyMap[key];
      };
      this.closePendingToastsEarlyMap[key] = closeToastEarly;
    }
    // Show the toast deferred by some timeout as instantly reopening a toast leads to a flickering effect.
    setTimeout(() => localNotificationAPI[type](toastConfig), 100);
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
    if (this.notificationAPI) {
      this.notificationAPI.destroy(key);
    }
  },
  message(
    type: ToastStyle,
    message: React.ReactNode = "Success :-)",
    config: ToastConfig = {},
    details?: string | undefined,
  ) {
    if (this.notificationAPI == null) {
      // If the notificationAPI is still being initialized, queue the toast.
      this.pendingToasts.push({ type, message, config, details });
      return;
    }
    // First, show any pending toasts.
    this.pendingToasts.forEach((toast) => {
      this._messageInternal(toast.type, toast.message, toast.config, toast.details);
    });
    this.pendingToasts = [];

    // If the notificationAPI is already initialized, use it.
    this._messageInternal(type, message, config, details);
  },
};
export default Toast;
