import _ from "lodash";
import FormSyphon from "form-syphon";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";

class DatasetEditView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="row">
  <div class="col-sm-12">
    <div class="well">
      <div class="col-sm-9 col-sm-offset-2">
        <h3>Update dataset</h3>
      </div>

      <form method="POST" class="form-horizontal">
        <div class="form-group">
          <label class="col-sm-2 control-label" for="name">Name</label>
          <div class="col-sm-9">
            <input type="text" id="name" name="name" value="<%- name %>" class="form-control" readonly />
          </div>
        </div>
        <div class="form-group">
          <label class="col-sm-2 control-label" for="description">Description</label>
          <div class="col-sm-9">
            <textarea id="description" name="description" class="form-control"><%- description %></textarea>
          </div>
        </div>
        <div class="form-group">
          <label class="col-sm-3 col-sm-offset-2" for="isPublic">
            <input type="checkbox" id="isPublic" name="isPublic" <%- isChecked(isPublic) %>>
              publicly accessible
          </label>
        </div>
        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-9">
          <button type="submit" class="form-control btn btn-primary">Update</button>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>\
`);

    this.prototype.className = "container wide dataset-administration";

    this.prototype.events = { "submit form": "submitForm" };

    this.prototype.ui = { form: "form" };
  }

  templateContext() {
    return {
      isChecked(bool) {
        return bool ? "checked" : "";
      },
    };
  }

  initialize() {
    this.listenTo(this.model, "sync", this.render);
    this.model.fetch();
  }

  submitForm(event) {
    event.preventDefault();

    if (!this.ui.form[0].checkValidity()) {
      Toast.error("Please supply all needed values.");
      return;
    }

    const formValues = FormSyphon.serialize(this.ui.form);

    this.model.save(formValues).then(() => Toast.success("Saved!"));
  }
}
DatasetEditView.initClass();

export default DatasetEditView;
