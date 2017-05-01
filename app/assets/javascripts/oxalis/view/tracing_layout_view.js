/**
 * tracing_layout_view.js
 * @flow
 */

import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import React from "react";
import { render } from "react-dom";
import { Provider } from "react-redux";
import app from "app";
import store from "oxalis/throttled_store";
import OxalisController from "oxalis/controller";
import OxalisModel from "oxalis/model";
import OxalisApi from "oxalis/api/api_loader";
import Constants from "oxalis/constants";
import Modal from "oxalis/view/modal";
import Utils from "libs/utils";
import SettingsView from "oxalis/view/settings/settings_view";
import ActionBarView from "oxalis/view/action_bar_view";
import RightMenuView from "oxalis/view/right_menu_view";
import UserScriptsModalView from "oxalis/view/user_scripts_modal";
import TracingView from "oxalis/view/tracing_view";
import enUS from "antd/lib/locale-provider/en_US";
import { LocaleProvider } from "antd";

const MARGIN = 40;

class TracingLayoutView extends Marionette.View {

  traceTemplate: (data: Object) => string;
  viewTemplate: (data: Object) => string;
  rightMenuView: Marionette.View<*>;
  model: OxalisModel;

  static initClass() {
    this.prototype.className = "text-nowrap";

    this.prototype.traceTemplate = _.template(`\
<div id="action-bar"></div>
<div id="sliding-canvas">
  <div id="settings-menu-wrapper" class="navmenu-fixed-left offcanvas">
    <div id="settings-menu"></div>
  </div>
  <div id="tracing"></div>
  <div id="right-menu"></div>
</div>
<div class="modal-wrapper"></div>\
`);

    this.prototype.viewTemplate = _.template(`\
<div id="action-bar"></div>
<div id="settings-menu"></div>
<div id="tracing"></div>
<div id="right-menu"></div>
<div class="modal-wrapper"></div>\
`);

    this.prototype.ui = {
      rightMenu: "#right-menu",
      slidingCanvas: "#sliding-canvas",
      actionBar: "#action-bar",
      settings: "#settings-menu",
    };

    this.prototype.regions = {
      rightMenu: "#right-menu",
      tracingContainer: "#tracing",
      modalWrapper: ".modal-wrapper",
    };

    this.prototype.events = {
      "hidden.bs.offcanvas #settings-menu-wrapper": "doneSliding",
      "shown.bs.offcanvas #settings-menu-wrapper": "doneSliding",
    };
  }

  getTemplate() {
    if (this.isTracingMode()) {
      return this.traceTemplate;
    } else {
      return this.viewTemplate;
    }
  }


  initialize(options?: Object): this {
    this.options = _.extend(
      {},
      options,
      { model: new OxalisModel(options) },
    );

    this.model = this.options.model;

    this.listenTo(app.vent, "planes:resize", this.resizeRightMenu);
    this.listenTo(this.model, "sync", this.renderRegions);
    $(window).on("resize", this.resizeRightMenu.bind(this));

    $("#add-script-link")
      .removeClass("hide")
      .on("click", this.showUserScriptsModal.bind(this));

    app.oxalis = new OxalisController(this.options);
    window.webknossos = new OxalisApi(this.model);
    return this;
  }


  doneSliding() {
    return this.resizeRightMenu();
  }


  resizeRightMenu() {
    if (this.isSkeletonMode()) {
      const menuPosition = this.ui.rightMenu.position();
      const slidingCanvasOffset = this.ui.slidingCanvas.position().left;

      const newWidth = window.innerWidth - menuPosition.left - slidingCanvasOffset - MARGIN;

      if (menuPosition.left < window.innerWidth && newWidth > 350) {
        this.ui.rightMenu.width(newWidth);
      }
    }
  }


  renderRegions() {
    this.render();

    const tracingView = new TracingView(this.options);

    this.showChildView("tracingContainer", tracingView, { preventDestroy: true });

    if (!this.model.settings.advancedOptionsAllowed) {
      return;
    }

    render(
      <LocaleProvider locale={enUS}>
        <Provider store={store}>
          <ActionBarView oldModel={this.model} />
        </Provider>
      </LocaleProvider>,
      this.ui.actionBar[0],
    );

    render(
      <Provider store={store}>
        <SettingsView isPublicViewMode={!this.isTracingMode()} />
      </Provider>,
      this.ui.settings[0],
    );

    render(
      <Provider store={store}>
        <RightMenuView oldModel={this.model} isPublicViewMode={!this.isTracingMode()} />
      </Provider>,
      this.ui.rightMenu[0],
    );

    this.maybeShowNewTaskTypeModal();
  }


  showUserScriptsModal(event: Event) {
    event.preventDefault();
    const modalView = new UserScriptsModalView();
    this.showChildView("modalWrapper", modalView);
    return modalView.show();
  }


  maybeShowNewTaskTypeModal() {
    // Users can aquire new tasks directly in the tracing view. Occasionally,
    // they start working on a new TaskType and need to be instructed.
    let text;
    if (!Utils.getUrlParams("differentTaskType") || (this.model.tracing.task == null)) { return; }

    const taskType = this.model.tracing.task.type;
    const title = `Attention, new Task Type: ${taskType.summary}`;
    if (taskType.description) {
      text = `You are now tracing a new task with the following description:<br>${taskType.description}`;
    } else {
      text = "You are now tracing a new task with no description.";
    }
    Modal.show(text, title);
  }


  isTracingMode() {
    return this.model.controlMode !== Constants.CONTROL_MODE_VIEW;
  }


  isSkeletonMode() {
    return Constants.MODES_SKELETON.includes(store.getState().viewMode) && this.isTracingMode();
  }


  isVolumeMode() {
    return store.getState().viewMode === Constants.MODE_VOLUME && this.isTracingMode();
  }


  isArbitraryMode() {
    return Constants.MODES_ARBITRARY.includes(store.getState().viewMode);
  }


  onDestroy() {
    $("#add-script-link")
      .addClass("hide")
      .off("click");
    app.oxalis = null;
  }
}
TracingLayoutView.initClass();

export default TracingLayoutView;
