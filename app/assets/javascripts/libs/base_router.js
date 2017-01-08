import $ from "jquery";
import _ from "lodash";
import Backbone from "backbone";

class BaseRouter {
  static initClass() {
    this.prototype.$mainContainer = null;
    this.prototype.routes = {};
  }

  constructor() {
    this.handlePopstate = this.handlePopstate.bind(this);
    this.handleRoute = this.handleRoute.bind(this);
    this.handleBeforeunload = this.handleBeforeunload.bind(this);
    this.triggerBeforeunload = this.triggerBeforeunload.bind(this);
    _.extend(this, Backbone.Events);
    this.activeViews = [];
    this.routes = _.map(this.routes, (handler, route) => ({
      // eslint-disable-next-line no-underscore-dangle
      route: Backbone.Router.prototype._routeToRegExp(route),
      handler: _.isString(handler) ? this[handler].bind(this) : handler,
    }),
    );
    window.addEventListener("popstate", this.handlePopstate);
    window.addEventListener("beforeunload", this.handleBeforeunload);

    this.setupClickHandler();

    this.currentURL = window.location.pathname + window.location.search + window.location.hash;
    _.defer(() => this.handleRoute());
  }


  setupClickHandler() {
    // handle all links and manage page changes (rather the reloading the whole site)
    return $(document).on("click", "a", (evt) => {
      let newWindow;
      const url = $(evt.currentTarget).attr("href") || "";

      if (newWindow = $(evt.target).data("newwindow")) {
        const [width, height] = newWindow.split("x");
        window.open(url, "_blank", `width=${width},height=${height},location=no,menubar=no`);
        evt.preventDefault();
        return;
      }

      // disable for links beginning with #
      if (url.indexOf("#") === 0) {
        return;
      }

      // allow opening links in new tabs
      if (evt.metaKey || evt.ctrlKey) {
        return;
      }

      // allow target=_blank etc
      if (evt.currentTarget.target !== "") {
        return;
      }

      for (const { route } of this.routes) {
        if (url.match(route)) {
          evt.preventDefault();
          this.navigate(url);

          return;
        }
      }
    },
    );
  }


  handlePopstate() {
    // Remember: URL is already changed

    if (!this.shouldNavigate(window.location.pathname)) {
      // Do nothing
      return;
    }

    // Check for beforeunload
    const beforeunloadValue = this.triggerBeforeunload();
    if ((beforeunloadValue != null) && !confirm(`${beforeunloadValue}\nDo you wish to navigate away?`)) {
      // Rollback to previous URL
      window.history.pushState({}, document.title, this.currentURL);
      return;
    }

    this.navigate(window.location.pathname, { trigger: false });
  }


  handleRoute() {
    const baseUrl = this.getBaseUrl();

    for (let { route, handler } of this.routes) {
      const match = baseUrl.match(route);
      if (match) {
        const args = Backbone.Router.prototype._extractParameters(route, baseUrl);
        handler(...args);
        return;
      }
    }
  }


  getBaseUrl() {
    // Return the baseUrl without urlParams or anchors/hashes
    const baseUrl = this.currentURL.replace(/\?.*$/, "").replace(/#.*$/, "");
    return baseUrl;
  }


  shouldNavigate(path) {
    return this.getBaseUrl() !== path;
  }


  navigate(path, param = {}) {
    let { trigger = true } = param;
    if (!this.shouldNavigate(path)) {
      // Do nothing
      return;
    }

    if (trigger) {
      const beforeunloadValue = this.triggerBeforeunload();
      if ((beforeunloadValue != null) && !confirm(`${beforeunloadValue}\nDo you wish to navigate away?`)) {
        return;
      }
      window.history.pushState({}, document.title, path);
    }
    this.currentURL = path;

    if (this.cleanupViews()) {
      _.defer(this.handleRoute);
    }
  }


  handleBeforeunload(e) {
    const beforeunloadValue = this.triggerBeforeunload();
    if (beforeunloadValue != null) {
      e.returnValue = beforeunloadValue;
    }
  }


  triggerBeforeunload() {
    // Triggers the registered `beforeunload` handlers and returns the first return value
    // Doesn't use Backbone's trigger because we need return values

    // eslint-disable-next-line no-underscore-dangle
    const handlers = __guard__(this._events, x => x.beforeunload) != null ? this._events.beforeunload : [];
    const beforeunloadValue = _.find(
      handlers.map(handler => handler.callback.call(handler.ctx)),
      value => (value != null));
    return beforeunloadValue;
  }


  cleanupViews() {
    // Remove current views
    if (this.activeViews.length > 0) {
      for (const view of this.activeViews) {
        // prefer Marionette's.destroy() function to Backbone's remove()
        if (view.destroy) {
          view.destroy();
        } else {
          view.remove();
        }

        if (view.forcePageReload) {
          window.removeEventListener("beforeunload", this.handleBeforeunload);
          this.reload();
          return false;
        }
      }
      this.activeViews = [];
    } else {
      // we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      this.$mainContainer.empty();
    }

    return true;
  }


  loadURL(url) {
    window.location.href = url;
  }


  reload() {
    window.location.reload();
  }
}
BaseRouter.initClass();

export default BaseRouter;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
