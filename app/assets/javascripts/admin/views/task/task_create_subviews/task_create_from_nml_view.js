import _ from "lodash";
import Marionette from "backbone.marionette";
import routes from "routes";
import Toast from "libs/toast";
import Request from "libs/request";

class TaskCreateFromNMLView extends Marionette.View {
  static initClass() {
    this.prototype.id = "create-from-nml";

    this.prototype.template = _.template(`\
<div class="form-group">
  <label class="col-sm-2 control-label" for="nmlFile">Reference NML File</label>
  <div class="col-sm-9">
    <div class="fileinput fileinput-new input-group" data-provides="fileinput">
      <div class="form-control" data-trigger="fileinput">
        <i class="fa fa-file fileinput-exists"></i>
        <span class="fileinput-filename"></span>
      </div>
      <span class="input-group-addon btn btn-default btn-file">
        <span class="fileinput-new">Browse...</span>
        <span class="fileinput-exists">Change</span>
        <input type="file" accept=".nml" name="nmlFile" title="Please select at least one .nml file" required>
      </span>
      <a href="#" class="input-group-addon btn btn-default fileinput-exists" data-dismiss="fileinput">Remove</a>
    </div>
  </div>
</div>\
`);

    this.prototype.ui =
      { fileUpload: "[type=file]" };
  }

  initialize(options) {
    return this.parent = options.parent;
  }


  /**
   * Submit NML Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  */
  submit() {
    const serializedForm = this.parent.serializeForm();
    this.model.set(serializedForm);

    const payload = new FormData();
    payload.append("formJSON", JSON.stringify(serializedForm));
    payload.append("nmlFile", this.ui.fileUpload[0].files[0]);

    const form = this.parent.ui.form[0];

    if (form.checkValidity()) {
      Toast.info("Uploading NML", false);

      Request.sendMultipartFormReceiveJSON("/api/tasks", {
        data: payload,
        params: { type: "nml" },
      },
      )
      .then(
        task => this.parent.showSaveSuccess(task),
        () => this.parent.showSaveError(),
      );
    }

    // prevent page reload
    return false;
  }
}
TaskCreateFromNMLView.initClass();

export default TaskCreateFromNMLView;
