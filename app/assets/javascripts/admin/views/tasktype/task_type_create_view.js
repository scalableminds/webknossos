import _ from "lodash";
import app from "app";
import FormSyphon from "form-syphon";
import Marionette from "backbone.marionette";
import "bootstrap-multiselect";
import TeamCollection from "admin/models/team/team_collection";
import SelectionView from "admin/views/selection_view";
import Toast from "libs/toast";

class TaskTypeCreateView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="row">
  <div class="col-sm-12">
    <div class="well">
      <div class="col-sm-9 col-sm-offset-2">
        <h3><%- getTitle() %> TaskType</h3>
      </div>

      <form method="POST" class="form-horizontal">
        <div class="form-group">
          <label class="col-sm-2 control-label" for="summary">Summary</label>
          <div class="col-sm-9">
          <input type="text" id="summary" name="summary" value="<%- summary %>" class="form-control"
             required pattern=".{3,}" title="Please use at least 3 characters.">
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="team">Team</label>
          <div class="col-sm-9 team">
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="description">Description (<a href="https://markdown-it.github.io/" target="_blank">Markdown enabled</a>)</label>
          <div class="col-sm-9">
          <textarea id="description" name="description" class="form-control"><%- description %></textarea>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="allowedModes">Allowed Modes</label>
          <div class="col-sm-9">
            <select multiple="multiple" name="settings[allowedModes[]]" class="form-control">
            <% ["flight", "orthogonal", "oblique"].forEach(function(mode) { %>
              <option value="<%-mode %>" <%- isSelected(_.includes(settings.allowedModes, mode)) %>> <%- mode %> </option>
            <% }) %>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label">Settings</label>
          <div class="col-sm-9">

            <label class="col-sm-3" for="somaClickingAllowed">
              <input type="checkbox" id="somaClickingAllowed" name="settings[somaClickingAllowed]" <%- isChecked(settings.somaClickingAllowed) %>>
              Allow Soma clicking
            </label>

            <label class="col-sm-3" for="branchPointsAllowed">
              <input type="checkbox" id="branchPointsAllowed" name="settings[branchPointsAllowed]" <%- isChecked(settings.branchPointsAllowed) %>>
              Allow Branchpoints
            </label>

            <label class="col-sm-3" for="advancedOptionsAllowed">
              <input type="checkbox" id="advancedOptionsAllowed" name="settings[advancedOptionsAllowed]" <%- isChecked(settings.advancedOptionsAllowed) %>>
              Advanced Tracing Options
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="col-sm-2 control-label" for="preferredMode">Preferred Mode</label>
          <div class="col-sm-9">
            <select id="preferredMode" name="settings[preferredMode]" class="form-control">
              <option>Any</option>
              <option value="orthogonal" <%- isSelected(settings.preferredMode == "orthogonal") %>>Orthogonal</option>
              <option value="oblique" <%- isSelected(settings.preferredMode == "oblique") %>>Oblique</option>
              <option value="flight" <%- isSelected(settings.preferredMode == "flight") %>>Flight</option>
            </select>
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
    this.prototype.className = "container wide task-types-administration";

    this.prototype.regions = { team: ".team" };

    this.prototype.events = { "submit form": "submitForm" };

    this.prototype.ui = {
      form: "form",
      multiselect: "select[multiple='multiple']",
    };
  }

  templateContext() {
    return {
      getTitle: () => (this.isEditingMode ? "Update" : "Create"),
      isChecked(bool) {
        return bool ? "checked" : "";
      },
      isSelected(bool) {
        return bool ? "selected" : "";
      },
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
    if (formValues.settings.preferredMode === "Any") {
      formValues.settings.preferredMode = null;
    }

    // Add 'required' attribute to select once it's supported
    // https://github.com/davidstutz/bootstrap-multiselect/issues/620
    if (_.isEmpty(formValues.settings.allowedModes)) {
      Toast.error("Please provide at least one allowed mode.");
      return;
    }

    this.model.save(formValues).then(() => app.history.push("/taskTypes"));
  }

  onRender() {
    const teamSelectionView = new SelectionView({
      collection: new TeamCollection(),
      childViewOptions: {
        modelValue() {
          return `${this.model.get("name")}`;
        },
        defaultItem: { name: this.model.get("team") },
      },
      data: "amIAnAdmin=true",
      name: "team",
      required: true,
    });
    this.showChildView("team", teamSelectionView);

    this.ui.multiselect.multiselect();
  }

  onBeforeDestroy() {
    this.ui.multiselect.multiselect("destroy");
  }
}
TaskTypeCreateView.initClass();

export default TaskTypeCreateView;
