import $ from "jquery";
import _ from "lodash";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import Request from "libs/request";
import app from "app";
import SelectionView from "admin/views/selection_view";
import ModalView from "admin/views/modal_view";
import UserCollection from "admin/models/user/user_collection";

class TaskTransferModalView extends ModalView {
  static initClass() {
  
    this.prototype.headerTemplate  = "<h3>Transfer a Task</h3>";
    this.prototype.bodyTemplate  = _.template(`\
<div class="control-group">
  <div class="form-group">
    <label>New User's Name</label>
    <div class="datalist"></div>
  </div>
</div>\
`);
    this.prototype.footerTemplate  = `\
<a href="#" class="btn btn-primary transfer">Transfer</a>
<a href="#" class="btn btn-default" data-dismiss="modal">Close</a>\
`;
  
  
    this.prototype.regions  =
      {"datalist" : ".datalist"};
  
    this.prototype.events  =
      {"click .transfer" : "transferTask"};
  }


  initialize(options) {

    this.url = options.url;
    return this.userCollection = new UserCollection();
  }


  onRender() {

    const selectionView = new SelectionView({
      collection : this.userCollection,
      childViewOptions : {
        modelValue() { return `${this.model.get("lastName")}, ${this.model.get("firstName")} (${this.model.get("email")})`; }
      }
    });
    this.showChildView("datalist", selectionView);

    return this.$el.modal("show");
  }


  transferTask(evt) {

    evt.preventDefault();

    const userID = this.$("select :selected").attr("id");
    return Request.sendJSONReceiveJSON(
      this.url, {
      data: {
        "userId" : userID
      }
    }
    ).then( () => {
      return this.destroy();
    }
    );
  }
}
TaskTransferModalView.initClass();


export default TaskTransferModalView;
