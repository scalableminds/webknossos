/**
 * arbitrary_plane_info.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import "bootstrap-toggle";
import Store from "oxalis/store";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";


class ArbitraryPlaneInfo extends Marionette.View {
  unsubscribeFunction: () => void;

  static initClass() {
    this.prototype.id = "arbitrary-info-canvas";

    this.prototype.template = _.template("\
<input type=\"checkbox\" <%- getCheckedStatus() %> >\
");

    this.prototype.templateContext = {
      getCheckedStatus() {
        return Store.getState().flightmodeRecording ? "checked" : "";
      },
    };

    this.prototype.events =
      { "change input": "handleCheckboxChange" };

    this.prototype.ui =
      { checkbox: "input" };
  }


  initialize() {
    this.unsubscribeFunction = listenToStoreProperty(
      storeState => storeState.flightmodeRecording,
      () => this.updateCheckboxToggle(),
    );
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
    Store.dispatch(setFlightmodeRecordingAction(value));

    // Set a inital waypoint when enabling flight mode
    // TODO: use the offical wK API
    if (value === true && app.oxalis) {
      app.oxalis.arbitraryController.setWaypoint();
    }
  }


  updateCheckboxToggle() {
    const flightmodeRecording = Store.getState().temporaryConfiguration.flightmodeRecording;
    if (flightmodeRecording === this.ui.checkbox.prop("checked")) {
      return;
    }
    this.ui.checkbox.prop({ checked: flightmodeRecording }).change();
  }


  onDestroy() {
    this.ui.checkbox.bootstrapToggle("destroy");
    this.unsubscribeFunction();
  }
}
ArbitraryPlaneInfo.initClass();


export default ArbitraryPlaneInfo;
