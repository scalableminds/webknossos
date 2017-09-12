import _ from "lodash";
import $ from "jquery";

export type ToastType = {
  remove: () => void,
};

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

const getToasts = (type, message) => $(`.alert-${type}[data-id='${hashCode(message)}']`);

const shouldDisplayToast = (type, message, sticky) =>
  // Don't show duplicate sticky toasts
  !sticky || getToasts(type, message).length === 0;

const Toast = {
  message(type, message, sticky = false, optTimeout): ToastType {
    let messages;
    if (_.isArray(type) && message == null) {
      messages = type;
      const toasts = messages.map(singleMessage => {
        if (singleMessage.success != null) {
          this.success(singleMessage.success);
        }
        if (singleMessage.error != null) {
          this.error(singleMessage.error);
        }
      });
      return {
        remove: () => toasts.foreach(toast => toast.remove()),
      };
    } else if (_.isArray(message)) {
      messages = message;
      return messages.map(singleMessage => this.message(type, singleMessage, sticky));
    } else if (shouldDisplayToast(type, message, sticky)) {
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
        remove() {
          return $closeButton.click();
        },
      };
    } else {
      return {};
    }
  },

  info(message, sticky) {
    return this.message("info", message, sticky);
  },

  warning(message, sticky) {
    return this.message("warning", message, sticky);
  },

  success(message = "Success :-)", sticky) {
    return this.message("success", message, sticky);
  },

  error(message = "Error :-/", sticky) {
    return this.message("danger", message, sticky);
  },

  highlight(target) {
    target.addClass("alert-wiggle");
  },

  delete(type, message) {
    getToasts(type, message).alert("close");
  },
};

export default Toast;
