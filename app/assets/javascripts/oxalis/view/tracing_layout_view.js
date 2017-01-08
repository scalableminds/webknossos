import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import app from "app";
import OxalisController from "oxalis/controller";
import OxalisModel from "oxalis/model";
import Constants from "oxalis/constants";
import BackboneToOxalisAdapterModel from "oxalis/model/settings/backbone_to_oxalis_adapter_model";
import Modal from "oxalis/view/modal";
import Utils from "libs/utils";
import ActionBarView from "./action_bar_view";
import SkeletonPlaneTabView from "./settings/tab_views/skeleton_plane_tab_view";
import SkeletonArbitraryTabView from "./settings/tab_views/skeleton_arbitrary_tab_view";
import VolumeTabView from "./settings/tab_views/volume_tab_view";
import ViewmodeTabView from "./settings/tab_views/viewmode_tab_view";
import SkeletonTracingRightMenuView from "./skeletontracing/skeletontracing_right_menu_view";
import VolumeTracingRightMenuView from "./volumetracing/volumetracing_right_menu_view";
import ViewmodeRightMenuView from "./viewmode/viewmode_right_menu_view";
import UserScriptsModalView from "./user_scripts_modal";
import TracingView from "./tracing_view";

class TracingLayoutView extends Marionette.View {
  constructor(...args) {
    super(...args);
    this.showUserScriptsModal = this.showUserScriptsModal.bind(this);
  }

  static initClass() {
    this.prototype.MARGIN = 40;

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
    };

    this.prototype.regions = {
      actionBar: "#action-bar",
      rightMenu: "#right-menu",
      tracingContainer: "#tracing",
      settings: "#settings-menu",
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


  initialize(options) {
    this.options = _.extend(
      {},
      options,
      { model: new OxalisModel(options) },
    );

    this.model = this.options.model;
    this.options.adapterModel = new BackboneToOxalisAdapterModel(this.model);

    this.listenTo(this, "render", this.afterRender);
    this.listenTo(app.vent, "planes:resize", this.resizeRightMenu);
    this.listenTo(this.model, "change:mode", this.renderSettings);
    this.listenTo(this.model, "sync", this.renderRegions);
    $(window).on("resize", this.resizeRightMenu.bind(this));

    $("#add-script-link")
      .removeClass("hide")
      .on("click", this.showUserScriptsModal.bind(this));

    return app.oxalis = new OxalisController(this.options);
  }


  doneSliding() {
    return this.resizeRightMenu();
  }


  resizeRightMenu() {
    if (this.isSkeletonMode()) {
      const menuPosition = this.ui.rightMenu.position();
      const slidingCanvasOffset = this.ui.slidingCanvas.position().left;

      const newWidth = window.innerWidth - menuPosition.left - slidingCanvasOffset - this.MARGIN;

      if (menuPosition.left < window.innerWidth && newWidth > 350) {
        return this.ui.rightMenu.width(newWidth);
      }
    }
  }


  renderRegions() {
    this.render();

    const actionBarView = new ActionBarView(this.options);
    const tracingView = new TracingView(this.options);

    this.showChildView("tracingContainer", tracingView, { preventDestroy: true });

    this.showChildView("actionBar", actionBarView, { preventDestroy: true });

    if (!this.model.settings.advancedOptionsAllowed) {
      return;
    }

    if (this.isSkeletonMode()) {
      this.rightMenuView = new SkeletonTracingRightMenuView(this.options);
    } else if (this.isVolumeMode()) {
      this.rightMenuView = new VolumeTracingRightMenuView(this.options);
    } else {
      this.rightMenuView = new ViewmodeRightMenuView(this.options);
    }

    this.showChildView("rightMenu", this.rightMenuView);
    this.renderSettings();
    return this.maybeShowNewTaskTypeModal();
  }


  showUserScriptsModal(event) {
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
    return Modal.show(text, title);
  }


  renderSettings() {
    // This method will be invoked again once the model is initialized as part of
    // the "sync" event callback.
    let settingsTabView;
    if (!this.model.initialized) { return; }

    if (this.isSkeletonMode()) {
      const settingsTabClass = this.isArbitraryMode() ? SkeletonArbitraryTabView : SkeletonPlaneTabView;
      settingsTabView = new settingsTabClass(this.options);
    } else if (this.isVolumeMode()) {
      settingsTabView = new VolumeTabView(this.options);
    } else {
      settingsTabView = new ViewmodeTabView(this.options);
    }

    return this.showChildView("settings", settingsTabView);
  }


  isTracingMode() {
    return this.model.get("controlMode") !== Constants.CONTROL_MODE_VIEW;
  }


  isSkeletonMode() {
    return Constants.MODES_SKELETON.includes(this.model.get("mode")) && this.isTracingMode();
  }


  isVolumeMode() {
    return this.model.get("mode") === Constants.MODE_VOLUME && this.isTracingMode();
  }


  isArbitraryMode() {
    return Constants.MODES_ARBITRARY.includes(this.model.get("mode"));
  }


  onDestroy() {
    $("#add-script-link")
      .addClass("hide")
      .off("click");
    return app.oxalis = null;
  }
}
TracingLayoutView.initClass();

export default TracingLayoutView;
