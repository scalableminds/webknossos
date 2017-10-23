// @flow

import _ from "lodash";
import $ from "jquery";

export type ToastType = {
  remove: () => void,
};

export type ToastStyleType = "info" | "warning" | "success" | "danger";

function hashCode(s) {
  return s.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);
}

function alertWithTimeout($this: JQuery, timeout = 3000) {
  $this.alert();
  let timerId = -1;

  $this.hover(
    () => clearTimeout(timerId),
    () => {
      timerId = setTimeout(() => $this.alert("close"), timeout);
    },
  );
  $(window).one("mousemove", () => $this.mouseout());
}

const getToasts = (type: ToastStyleType, message: string) =>
  $(`.alert-${type}[data-id='${hashCode(message)}']`);

const shouldDisplayToast = (type: ToastStyleType, message: string, sticky: boolean) =>
  // Don't show duplicate sticky toasts
  !sticky || getToasts(type, message).length === 0;

const Toast = {
  messages(messages: Array<{ success: string } | { error: string }>): ToastType {
    const toasts = messages.map(singleMessage => {
      if (singleMessage.success != null) {
        return this.success(singleMessage.success);
      }
      if (singleMessage.error != null) {
        return this.error(singleMessage.error);
      }
      return { remove: _.noop };
    });
    return {
      remove: () => toasts.forEach(toast => toast.remove()),
    };
  },

  message(
    type: ToastStyleType,
    message: string,
    sticky: boolean = false,
    optTimeout?: number,
  ): ToastType {
    if (shouldDisplayToast(type, message, sticky)) {
      let displayMessage;
      if (message.match(/<html[^>]*>/)) {
        displayMessage = `<iframe src='data:text/html;charset=utf-8,${escape(message)}'></iframe>`;
      } else {
        displayMessage = message;
      }
      const $messageElement = $("<div>", {
        class: `alert alert-${type} fade in`,
        "data-id": hashCode(message),
      }).html(displayMessage);
      const $closeButton = $("<button>", {
        type: "button",
        class: "close",
        "data-dismiss": "alert",
      }).html("&times;");
      $messageElement.prepend($closeButton);
      if (sticky) {
        $messageElement.alert();
      } else {
        const timeout = optTimeout || (type === "danger" ? 6000 : 3000);
        alertWithTimeout($messageElement, timeout);
      }
      $("#alert-container").append($messageElement);

      if (type === "danger") {
        this.highlight($messageElement);
      }

      return {
        remove: () => {
          $closeButton.click();
        },
      };
    } else {
      return {
        remove: _.noop,
      };
    }
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
    return this.message("danger", message, sticky);
  },

  highlight(target: JQuery) {
    target.addClass("alert-wiggle");
  },

  delete(type: ToastStyleType, message: string) {
    getToasts(type, message).alert("close");
  },
};

export default Toast;
