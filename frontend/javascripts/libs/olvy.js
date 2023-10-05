// Downloaded on 2023-10-05 from https://app.olvy.co/script.js
(function () {
  "use strict";
  if (window.Olvy) {
    console.warn("[Olvy] - Embed code already exists. Please check if you've imported it twice");
  }
  const API_URL = "https://app.olvy.co/api/v2";
  window.Olvy = {
    visible: false,
    contentLoaded: false,
    config: {
      id: "",
      organisation: "",
      target: "#olvy-trigger",
      type: "modal",
      view: {
        showSearch: false,
        compact: false,
        showUnreadIndicator: false,
        unreadIndicatorColor: "#cc1919",
        unreadIndicatorPosition: "top-right",
      },
      maxReleases: 10,
      user: { identifier: "", email: "", name: "", meta: {} },
    },
    modalElement: null,
    debounce(callback, wait) {
      let timeoutId = null;
      return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          callback.apply(null, args);
        }, wait);
      };
    },
    __handleWidgetSetup() {
      console.log("widget setup is called");
      if (this.config.type === "embed") {
        this.setupEmbedFrame();
      }
      const el = document.querySelector(this.config.target);
      if (!el) {
        console.warn(
          "[Olvy] - Target element not found. Call Olvy.show() to open your releases widget manually",
        );
        if (this.config.type !== "embed") {
          this.setupModal();
        }
      } else {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.show();
        });
        const targetRect = el.getBoundingClientRect();
        const { x, y } = targetRect;
        document.addEventListener("mousemove", (e) => {
          if (
            e.x < x + 300 &&
            e.x > x - 300 &&
            e.y < y + 300 &&
            e.y > y - 300 &&
            this.modalElement === null
          ) {
            this.debounce(this.setupModal(), 500);
          }
        });
        if (this.config.view.showUnreadIndicator) {
          this.refreshUnreadCount();
        } else {
          this.removeUnreadIndicatorElement();
        }
      }
    },
    __getOrgAndIDSuffixed(value) {
      return `${value}-${this.config.organisation}${this.config.id ? `-${this.config.id}` : ""}`;
    },
    __registerView() {
      window.frames[this.__getOrgAndIDSuffixed("olvy")].postMessage(
        { key: this.__getOrgAndIDSuffixed(`olvy-register-view`), value: "" },
        "*",
      );
    },
    init(config) {
      if (config.organisation === "") {
        window.warn("organisation is empty. not intializing Olvy");
        return;
      }
      this.__registerEvent("script_load", null, config.organisation, null, null);
      const viewConfig = Object.assign({}, this.config.view, config.view || {});
      this.config = Object.assign({}, this.config, config);
      this.config.view = viewConfig;
      if (this.config.target !== "") {
        if (document.readyState === "complete") {
          this.__handleWidgetSetup();
        } else {
          window.addEventListener("load", () => {
            this.__handleWidgetSetup();
          });
        }
      }
      if (this.config.organisation) {
        window.addEventListener(
          "message",
          (e) => {
            if (
              e.data === this.__getOrgAndIDSuffixed(`olvy-close`) ||
              (typeof e.data === "string" && e.data.startsWith("olvy-close"))
            ) {
              this.hide();
            } else if (e.data === this.__getOrgAndIDSuffixed(`olvy-embed-loaded`)) {
              this.contentLoaded = true;
              if (this.config.user && this.config.user.identifier) {
                this.setUser(this.config.user);
              }
              if (this.config.type === "embed") {
                this.__registerView();
              }
            }
          },
          false,
        );
      }
      this.insertCSS();
    },
    setupModal() {
      const modalElement = document.createElement("div");
      modalElement.id = this.__getOrgAndIDSuffixed(`olvy-modal`);
      modalElement.classList.add("olvy-modal");
      modalElement.innerHTML = `
      <div class="olvy-modal-overlay" id="${this.__getOrgAndIDSuffixed(
        "olvy-modal-overlay",
      )}"></div>
        <div class="olvy-frame-container olvy-frame-${
          this.config.type
        }" id="${this.__getOrgAndIDSuffixed("olvy-frame-container")}">
          <iframe class="olvy-frame" name="${this.__getOrgAndIDSuffixed("olvy")}" src="https://${
        this.config.organisation
      }.olvy.co/embed?embedId=${this.config.id}&hideSearch=${!this.config.view
        .showSearch}&compact=${this.config.view.compact}"></iframe>
        </div>
      `;
      document.querySelector("body").appendChild(modalElement);
      const overlay = document.querySelector(
        `#${this.__getOrgAndIDSuffixed("olvy-modal-overlay")}`,
      );
      if (overlay) {
        overlay.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.hide();
        });
      }
      const modalContainer = document.querySelector(
        `#${this.__getOrgAndIDSuffixed("olvy-frame-container")}`,
      );
      if (modalContainer) {
        modalContainer.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.hide();
        });
      }
      document.addEventListener("keydown", (e) => {
        if (e.keyCode == 27) {
          this.hide();
        }
      });
      this.modalElement = modalElement;
    },
    setupEmbedFrame() {
      const frameElement = document.querySelector(this.config.target);
      if (frameElement) {
        frameElement.innerHTML = `<iframe class="olvy-frame" name="${this.__getOrgAndIDSuffixed(
          "olvy",
        )}" src="https://${this.config.organisation}.olvy.co/embed?embedId=${
          this.config.id
        }&hideSearch=${!this.config.view.showSearch}&compact=${
          this.config.view.compact
        }&hideHeader=${!this.config.view
          .showHeader}&hideClose=true" style="height: 100%; width: 100%; border: none;"></iframe>`;
        this.frameElement = frameElement;
      }
    },
    setUser(user) {
      if (!user.identifier) {
        return false;
      }
      this.config.user = Object.assign({}, this.config.user, user);
      if (this.contentLoaded) {
        window.frames[this.__getOrgAndIDSuffixed("olvy")].postMessage(
          { key: this.__getOrgAndIDSuffixed(`olvy-setUser`), value: this.config.user },
          "*",
        );
      }
      return true;
    },
    insertCSS() {
      let CSSElement = document.querySelector(`style#olvy-css-${this.config.organisation}`);
      if (!CSSElement) {
        const styleEl = document.createElement("style");
        styleEl.id = `olvy-css-${this.config.organisation}`;
        CSSElement = styleEl;
      }
      CSSElement.innerHTML = `
        ${this.config.target} {
          position: relative;
        }

        .olvy-modal {
          display: none;
          transition: display 0.5s ease-in-out;
        }

        .olvy-widget-open {
          overflow: hidden !important;
        }

        .olvy-modal.visible {
          display: block;
          position: fixed;
          top: 0;
          right: 0;
          left: 0;
          bottom: 0;
          z-index: 2000000;
        }

        .olvy-modal-overlay {
          position: fixed;
          top: 0;
          right: 0;
          left: 0;
          bottom: 0;
          background-color: #000000bf;
          z-index: 2000000;
        }

        .olvy-frame-modal .olvy-frame {
          max-height: 45rem;
          height: 100%;
          max-width: 700px;
          width: 100%;
          border-radius: 8px;
          overflow: hidden;
          border: none;
        }

        .olvy-frame-sidebar .olvy-frame {
          height: 100%;
          max-width: 450px;
          width: 100%;
          border-radius: 8px;
          overflow: hidden;
          border: none;
          position: fixed;
          right: 0;
          top: 0;
          bottom: 0;
        }

        .olvy-frame-container {
          height: 100%;
          width: 100%;
          z-index: 2000002;
          position: relative;
        }

        .olvy-frame-container.olvy-frame-modal {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .olvy-unread-indicator.olvy-organisation-${this.config.organisation} {
          position: absolute;
          display: block;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: ${this.config.view.unreadIndicatorColor};
          box-shadow: 0 0 0 ${this.config.view.unreadIndicatorColor};
          animation: olvyPulse-${this.config.organisation} 2s infinite;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          color: #fff;
        }

        .olvy-unread-indicator.olvy-organisation-${this.config.organisation}.top-right {
          right: -10px;
          top: -10px;
        }

        .olvy-unread-indicator.olvy-organisation-${this.config.organisation}.top-left {
          left: -10px;
          top: -10px;
        }

        .olvy-unread-indicator.olvy-organisation-${this.config.organisation}.bottom-left {
          bottom: -10px;
          left: -10px;
        }
        .olvy-unread-indicator.olvy-organisation-${this.config.organisation}.bottom-right {
          bottom: -10px;
          right: -10px;
        }

        @-webkit-keyframes olvyPulse-${this.config.organisation} {
          0% {
            -webkit-box-shadow: 0 0 0 0 ${this.config.view.unreadIndicatorColor};
          }
          70% {
              -webkit-box-shadow: 0 0 0 10px #0000;
          }
          100% {
              -webkit-box-shadow: 0 0 0 0 #0000;
          }
        }
        @keyframes olvyPulse-${this.config.organisation} {
          0% {
            -moz-box-shadow: 0 0 0 0 ${this.config.view.unreadIndicatorColor};
            box-shadow: 0 0 0 0 ${this.config.view.unreadIndicatorColor};
          }
          70% {
              -moz-box-shadow: 0 0 0 10px #0000;
              box-shadow: 0 0 0 10px #0000;
          }
          100% {
              -moz-box-shadow: 0 0 0 0 #0000;
              box-shadow: 0 0 0 0 #0000;
          }
        }
      `;
      document.querySelector("head").appendChild(CSSElement);
    },
    show() {
      let modalElement = document.querySelector(`#${this.__getOrgAndIDSuffixed(`olvy-modal`)}`);
      if (!modalElement) {
        this.setupModal();
      }
      modalElement = document.querySelector(`#${this.__getOrgAndIDSuffixed(`olvy-modal`)}`);
      modalElement.classList.add("visible");
      const bodyElement = document.querySelector(`body`);
      bodyElement.classList.add("olvy-widget-open");
      this.visible = true;
      window.localStorage.setItem(
        `olvy-${this.config.organisation}-lastOpened`,
        new Date().toISOString(),
      );
      if (this.contentLoaded) {
        this.__registerView();
      }
      if (
        document.querySelector(this.config.target) &&
        document
          .querySelector(this.config.target)
          .querySelector(`.olvy-unread-indicator.olvy-organisation-${this.config.organisation}`)
      ) {
        document
          .querySelector(this.config.target)
          .removeChild(
            document
              .querySelector(this.config.target)
              .querySelector(
                `.olvy-unread-indicator.olvy-organisation-${this.config.organisation}`,
              ),
          );
      }
    },
    hide() {
      const modalElement = document.querySelector(`#${this.__getOrgAndIDSuffixed(`olvy-modal`)}`);
      if (modalElement) {
        modalElement.classList.remove("visible");
      }
      const bodyElement = document.querySelector(`body`);
      if (bodyElement) {
        bodyElement.classList.remove("olvy-widget-open");
      }
      this.visible = false;
    },
    addUnreadIndicatorElement(count) {
      this.removeUnreadIndicatorElement();
      const throbber = document.createElement("div");
      throbber.classList.add(
        "olvy-unread-indicator",
        `olvy-organisation-${this.config.organisation}`,
        this.config.view.unreadIndicatorPosition,
      );
      if (count !== undefined) {
        throbber.innerText = count > 9 ? 9 : count;
      }
      if (document.querySelector(this.config.target)) {
        document.querySelector(this.config.target).appendChild(throbber);
      }
    },
    removeUnreadIndicatorElement() {
      if (
        document.querySelector(this.config.target) &&
        document
          .querySelector(this.config.target)
          .querySelector(`.olvy-unread-indicator.olvy-organisation-${this.config.organisation}`)
      ) {
        document
          .querySelector(this.config.target)
          .removeChild(
            document
              .querySelector(this.config.target)
              .querySelector(
                `.olvy-unread-indicator.olvy-organisation-${this.config.organisation}`,
              ),
          );
      }
    },
    refresh() {
      this.teardown();
      this.init(this.config);
    },
    async refreshUnreadCount() {
      const lastOpened = window.localStorage.getItem(`olvy-${this.config.organisation}-lastOpened`);
      if (lastOpened) {
        const unreadReleases = await this.getUnreadReleasesCount(lastOpened);
        if (unreadReleases > 0) {
          this.addUnreadIndicatorElement(unreadReleases);
        }
      }
    },
    async getLastOpenedTimestamp() {
      const lastOpened = window.localStorage.getItem(`olvy-${this.config.organisation}-lastOpened`);
      return lastOpened;
    },
    async __registerEvent(eventType, value, organisationId, userId, meta) {
      if (
        ["localhost", "127.0.0.1", "", "::1"].includes(window.location.hostname) ||
        window.location.hostname.startsWith("192.168.") ||
        window.location.hostname.startsWith("10.0.") ||
        window.location.hostname.endsWith(".local")
      ) {
        console.warn("[Olvy] - not registering script events on localhost");
      }
      if (eventType == "script_load" && window !== undefined) {
        try {
          const timestamp = window.localStorage.getItem(`olvy-script-load-${organisationId}`);
          if (timestamp) {
            const lastTimestamp = new Date(timestamp);
            const lastString = `${lastTimestamp.getDate()}${lastTimestamp.getMonth()}${lastTimestamp.getFullYear()}`;
            const now = new Date();
            const nowString = `${now.getDate()}${now.getMonth()}${now.getFullYear()}`;
            if (lastString == nowString) {
              return;
            }
          }
          window.localStorage.setItem(
            `olvy-script-load-${organisationId}`,
            new Date().toISOString(),
          );
        } catch (e) {
          console.error("[Olvy] - error logging script load event");
        }
      }
      var myHeaders = new Headers();
      myHeaders.append("Content-Type", "application/json");
      var requestOptions = {
        method: "POST",
        headers: myHeaders,
        body: JSON.stringify({ eventType, value, organisationId, userId, meta }),
        redirect: "follow",
      };
      fetch(`${API_URL}/register_event`, requestOptions);
    },
    async getUnreadReleasesCount(timestamp) {
      try {
        const response = await fetch(
          `${API_URL}/organisations/${this.config.organisation}/release_notes/unread?t=${timestamp}`,
        );
        if (response.ok) {
          const json = await response.json();
          return json.count || 0;
        } else {
          return 0;
        }
      } catch (e) {
        console.log("[Olvy] - Error fetching unread count");
        return 0;
      }
    },
    teardown() {
      if (document.querySelector(`#${this.__getOrgAndIDSuffixed(`olvy-modal`)}`)) {
        document.body.removeChild(
          document.querySelector(`#${this.__getOrgAndIDSuffixed(`olvy-modal`)}`),
        );
      }
      if (document.querySelector(this.config.target)) {
        document.querySelector(this.config.target).removeEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.show();
        });
      }
      window.removeEventListener(
        "message",
        (e) => {
          if (e.data === `olvy-close-${this.config.organisation}`) {
            this.hide();
          }
        },
        false,
      );
    },
  };
  try {
    if (OlvyConfig) {
      window.Olvy.init(OlvyConfig);
    }
  } catch (e) {
    console.warn("[Olvy] - Ran into an issue initialising from OlvyConfig variable");
  }
})();

// Added to suppress warning emitted by Olvy because it tries to eagerly initialize
window.OlvyConfig = null;
