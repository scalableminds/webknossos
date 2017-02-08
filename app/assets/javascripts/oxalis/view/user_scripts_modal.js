/**
 * user_scripts_modal.js
 * @flow weak
 */

/* eslint-disable no-eval, no-alert */
import _ from "lodash";
import Marionette from "backbone.marionette";

class UserScriptsModalView extends Marionette.View {
  static initClass() {
    this.prototype.className = "modal fade";
    this.prototype.template = _.template(`\
<div class="modal-dialog modal-lg">
  <div class="modal-content">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal">&times;</button>
      <h3>Add user script</h3>
    </div>
    <div class="modal-body">
      <textarea id="add-script-input" rows="10" autofocus></textarea>
    </div>
    <div class="modal-footer">
      <a href="#" id="add-script-button" class="btn btn-default">Add</a>
      <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
    </div>
  </div>
</div>\
`);

    this.prototype.ui =
      { inputBox: "#add-script-input" };

    this.prototype.events =
      { "click #add-script-button": "handleAddClick" };

    this.prototype.attributes = {
      tabindex: "-1",
      role: "dialog",
    };
  }


  show() {
    return this.$el.modal("show");
  }


  handleAddClick() {
    try {
      eval(this.ui.inputBox.val());
      // close modal if the script executed successfully
      return this.$el.modal("hide");
    } catch (error) {
      console.error(error);
      return alert(error);
    }
  }
}
UserScriptsModalView.initClass();


export default UserScriptsModalView;
