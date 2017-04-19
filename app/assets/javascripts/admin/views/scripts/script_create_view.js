import _ from "lodash";
import app from "app";
import FormSyphon from "form-syphon";
import Marionette from "backbone.marionette";
import UserCollection from "admin/models/user/user_collection";
import SelectionView from "admin/views/selection_view";
import Toast from "libs/toast";

class ScriptCreateView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="row">
  <div class="col-sm-12">
    <div class="well">
      <div class="col-sm-9 col-sm-offset-2">
        <h3><%- getTitle() %> Scripts</h3>
      </div>

      <form method="POST" class="form-horizontal">
        <div class="form-group">
          <label class="col-sm-2 control-label" for="name">Script Name</label>
          <div class="col-sm-9">
            <input type="text" id="name" name="name" value="<%- name %>" class="form-control"
             required pattern=".{3,}" title="Please use at least 3 characters.">
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="gist">Gist URL</label>
          <div class="col-sm-9">
            <input type="url" id="gist" name="gist" value="<%- gist %>" class="form-control">
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="ownerId">Owner</label>
          <div class="col-sm-9 ownerId">
          </div>
        </div>

        <div class="form-group">
          <div class="col-sm-2 col-sm-offset-9">
          <button type="submit" class="form-control btn btn-primary"><%- getTitle() %></button>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>\
`);
    this.prototype.className = "container wide";

    this.prototype.events =
      { "submit form": "submitForm" };

    this.prototype.regions = {
      ownerId: ".ownerId",
    };

    this.prototype.ui = {
      form: "form",
    };
  }

  templateContext() {
    return {
      getTitle: () => this.isEditingMode ? "Update" : "Create",
    };
  }


  initialize() {
    this.isEditingMode = _.isString(this.model.id);

    if (this.isEditingMode) {
      this.listenTo(this.model, "sync", this.render);
      this.model.fetch();
    }


  }


  submitForm(event) {
    event.preventDefault();

    if (!this.ui.form[0].checkValidity()) {
      Toast.error("Please supply all needed values.");
      return;
    }

    const formValues = FormSyphon.serialize(this.ui.form);

    this.model.save(formValues).then(
      () => app.router.navigate("/scripts", { trigger: true }));
  }

  onRender() {
    const owner = this.model.get("owner");
    const defaultUserId = owner ? owner.id : app.currentUser.id;
    const userSelectionView = new SelectionView({
      collection: new UserCollection(),
      childViewOptions: {
        modelValue() { return this.model.id; },
        modelLabel() { return `${this.model.get("lastName")}, ${this.model.get("firstName")} (${this.model.get("email")})`; },
        defaultItem: { id: defaultUserId },
      },
      name: "ownerId",
      data: "isAdmin=true",
    });
    this.showChildView("ownerId", userSelectionView);
  }

}
ScriptCreateView.initClass();


export default ScriptCreateView;
