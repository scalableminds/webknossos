import _ from "lodash";
import Marionette from "backbone.marionette";
import Clipboard from "clipboard-js";
import app from "app";
import constants from "oxalis/constants";
import utils from "libs/utils";
import Toast from "libs/toast";
import { V3 } from "libs/mjs";
import Store from "oxalis/store";
import { setPositionAction, setRotationAction } from "oxalis/model/actions/flycam_actions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";

class DatasetPositionView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "div";
    this.prototype.className = "form-inline dataset-position-view";
    this.prototype.template = _.template(`\
<div class="form-group">
  <div class="input-group">
    <span class="input-group-btn">
      <button class="btn btn-primary">Position</button>
    </span>
    <input id="trace-position-input" class="form-control" type="text" value="<%- position() %>">
  </div>
</div>
<div class="form-group">
  <% if(isArbitrayMode()) { %>
    <div class="input-group">
      <span class="input-group-addon">Rotation</span>
      <input id="trace-rotation-input" class="form-control" type="text" value="<%- rotation() %>">
    </div>
  <% } %>
</div>\
`);

    this.prototype.templateContext = {
      position() {
        return V3.floor(getPosition(Store.getState().flycam)).join(", ");
      },

      rotation() {
        return V3.round(getRotation(Store.getState().flycam)).join(", ");
      },

      isArbitrayMode() {
        return constants.MODES_ARBITRARY.includes(this.mode);
      },
    };


    this.prototype.events = {
      "change #trace-position-input": "changePosition",
      "change #trace-rotation-input": "changeRotation",
      "click button": "copyToClipboard",
    };

    this.prototype.ui = {
      positionInput: "#trace-position-input",
      rotationInput: "#trace-rotation-input",
    };
  }


  initialize() {
    this.render = _.throttle(this.render, 100);
    this.listenTo(this.model, "change:mode", this.render);

    this._unsubscribe = Store.subscribe(() => {
      this.render();
    });
  }


  // Rendering performance optimization
  attachElContent(html) {
    this.el.innerHTML = html;
    return html;
  }


  changePosition(event) {
    const posArray = utils.stringToNumberArray(event.target.value);
    if (posArray.length === 3) {
      Store.dispatch(setPositionAction(posArray));
      app.vent.trigger("centerTDView");
      this.ui.positionInput.get(0).setCustomValidity("");
    } else {
      this.ui.positionInput.get(0).setCustomValidity("Please supply a valid position, like 1,1,1!");
      this.ui.positionInput.get(0).reportValidity();
    }
  }


  changeRotation(event) {
    const rotArray = utils.stringToNumberArray(event.target.value);
    if (rotArray.length === 3) {
      Store.dispatch(setRotationAction(rotArray));
      this.ui.rotationInput.get(0).setCustomValidity("");
    } else {
      this.ui.rotationInput.get(0).setCustomValidity("Please supply a valid rotation, like 1,1,1!");
      this.ui.rotationInput.get(0).reportValidity();
    }
  }


  copyToClipboard(evt) {
    evt.preventDefault();

    const positionString = this.ui.positionInput.val();
    Clipboard.copy(positionString).then(
      () => Toast.success("Position copied to clipboard"));
  }

  onDestroy() {
    this._unsubscribe();
  }
}
DatasetPositionView.initClass();

export default DatasetPositionView;
