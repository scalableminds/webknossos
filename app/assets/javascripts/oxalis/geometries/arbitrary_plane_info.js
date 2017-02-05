/**
 * arbitrary_plane_info.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import "bootstrap-toggle";

class ArbitraryPlaneInfo extends Marionette.View {
  static initClass() {
    this.prototype.id = "arbitrary-info-canvas";

    this.prototype.template = _.template("\
<input type=\"checkbox\" <%= getCheckedStatus() %> >\
");

    this.prototype.templateContext = {
      getCheckedStatus() {
        return this.flightmodeRecording ? "checked" : "";
      },
    };

    this.prototype.events =
      { "change input": "handleCheckboxChange" };

    this.prototype.ui =
      { checkbox: "input" };
  }


  initialize() {
    this.listenTo(this.model, "change:flightmodeRecording", this.updateCheckboxToggle);
  }


  onRender() {
    this.ui.checkbox.bootstrapToggle({
      off: "Watching",
      offstyle: "success",
      on: "RECORDING",
      onstyle: "danger",
      width: 140,
    });
    this.updateCheckboxToggle();
  }


  handleCheckboxChange(evt) {
    const value = evt.target.checked;
    this.model.set("flightmodeRecording", value);

    // Set a inital waypoint when enabling flight mode
    // TODO: use the offical wK API
    if (value === true && app.oxalis) {
      app.oxalis.arbitraryController.setWaypoint();
    }
  }


  updateCheckboxToggle() {
    if (this.model.get("flightmodeRecording") === this.ui.checkbox.prop("checked")) {
      return;
    }
    this.ui.checkbox.prop({ checked: this.model.get("flightmodeRecording") }).change();
  }


  onDestroy() {
    this.ui.checkbox.bootstrapToggle("destroy");
  }
}
ArbitraryPlaneInfo.initClass();


export default ArbitraryPlaneInfo;
