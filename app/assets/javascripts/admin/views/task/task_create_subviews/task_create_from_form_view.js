import _ from "lodash";
import Marionette from "backbone.marionette";
import DatasetCollection from "admin/models/dataset/dataset_collection";
import SelectionView from "admin/views/selection_view";
import Utils from "libs/utils";
import Request from "libs/request";

class TaskCreateFromFormView extends Marionette.View {
  static initClass() {
    this.prototype.id = "create-from-form";

    // clear all form inputs when task was successfully created
    this.prototype.CLEAR_ON_SUCCESS = true;

    this.prototype.template = _.template(`\
<div class=" form-group">
  <label class="col-sm-2 control-label" for="dataSet">Dataset</label>
  <div class="col-sm-9 dataSet">
  </div>
</div>

<div class=" form-group">
  <label class="col-sm-2 control-label" for="editPosition">Start</label>
  <div class="col-sm-9">
    <input
      type="text"
      id="editPosition"
      name="editPosition"
      placeholder="x, y, z"
      title="x, y, z"
      pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
      value="<%- editPosition %>"
      required
      class="form-control">
  </div>
</div>

<div class=" form-group">
  <label class="col-sm-2 control-label" for="editRotation">Start Rotation</label>
  <div class="col-sm-9">
    <input
      type="text"
      id="editRotation"
      name="editRotation"
      placeholder="Rotation x, Rotation y, Rotation z"
      title="Rotation x, Rotation y, Rotation z"
      pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
      value="<%- editRotation %>"
      required
      class="form-control">
  </div>
</div>\
`);

    this.prototype.regions = { dataSet: ".dataSet" };

    this.prototype.ui = {
      editPosition: "#editPosition",
      editRotation: "#editRotation",
    };
  }

  initialize(options) {
    this.parent = options.parent;
  }

  serializeForm() {
    const formValues = this.parent.serializeForm();
    formValues.editPosition = Utils.stringToNumberArray(this.ui.editPosition.val());
    formValues.editRotation = Utils.stringToNumberArray(this.ui.editRotation.val());

    return formValues;
  }

  /**
   * Submit Form via AJAX to server.
   * @return {Boolean} false, prevent page reload
  */
  async submit(event) {
    event.preventDefault();
    const serializedForm = this.serializeForm();

    // unblock submit button after model synched
    // show a status flash message
    try {
      const method = this.parent.isEditingMode ? "PUT" : "POST";
      const response = await Request.sendJSONReceiveJSON(this.model.url(), {
        method,
        data: serializedForm,
        params: { type: "default" },
      });
      if (this.parent.isEditingMode) {
        this.props.history.push("/tasks");
      } else {
        this.parent.showSaveSuccess(response);
      }
    } catch (e) {
      this.parent.showSaveError();
    }
  }

  /**
  * Render a dataset SelectionView.
  */
  onRender() {
    this.dataSetSelectionView = new SelectionView({
      collection: new DatasetCollection(),
      childViewOptions: {
        modelValue() {
          return `${this.model.get("name")}`;
        },
        defaultItem: { name: this.model.get("dataSet") },
      },
      data: "amIAnAdmin=true&isActive=true",
      name: "dataSet",
      parentModel: this.model,
    });

    this.showChildView("dataSet", this.dataSetSelectionView);
  }
}
TaskCreateFromFormView.initClass();

export default TaskCreateFromFormView;
