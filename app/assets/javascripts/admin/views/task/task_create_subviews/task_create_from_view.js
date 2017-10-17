import _ from "lodash";
import Marionette from "backbone.marionette";
import FormSyphon from "form-syphon";
import TaskTypeCollection from "admin/models/tasktype/task_type_collection";
import TeamCollection from "admin/models/team/team_collection";
import ProjectCollection from "admin/models/project/project_collection";
import ScriptCollection from "admin/models/scripts/script_collection";
import SelectionView from "admin/views/selection_view";
import Toast from "libs/toast";
import Utils from "libs/utils";
import TaskCreateFromFormView from "admin/views/task/task_create_subviews/task_create_from_form_view";
import TaskCreateFromNMLView from "admin/views/task/task_create_subviews/task_create_from_nml_view";
import Modal from "oxalis/view/modal";

class TaskCreateFromView extends Marionette.View {
  static initClass() {
    // which type of form is created?
    // from_form/ from_nml
    this.prototype.type = null;
    this.prototype.id = "create-from";

    this.prototype.template = _.template(`\
<div class="row">
  <div class="col-sm-12">
  <div class="well">
    <div class="col-sm-9 col-sm-offset-2">
      <% if (type == "from_form") { %>
        <h3><%- getActionName() %> Task</h3>
        <br/>
      </div>
      <% } else if (type == "from_nml") { %>
        <h3>Create Task from explorative SkeletonTracing</h3>
        <p>Every nml creates a new task. You can either upload a single NML file or a zipped collection of nml files (.zip).</p>
        <br/>
      </div>
      <% } %>
      <form id="createForm" action="" method="POST" class="form-horizontal" onSubmit="return false;">

      <div class="form-group">
        <label class="col-sm-2 control-label" for="taskType">Task type</label>
        <div class="col-sm-9">
          <div class="taskType"></div>
          <span class="help-block">
            <a href="/taskTypes">Create a new Type</a>
          </span>
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="experience_domain">Experience Domain</label>
        <div class="col-sm-9">
          <input type="text" class="form-control" name="neededExperience[domain]" value="<%- neededExperience.domain %>" placeholder="Enter a domain (min. 3 characters)" pattern=".{3,}" required>
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="experience_value">Min Experience</label>
        <div class="col-sm-9">
          <input type="number" id="value" name="neededExperience[value]" value="<%- neededExperience.value %>" class="form-control" required>
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="status_open"><%- getInstanceLabel() %></label>
        <div class="col-sm-9">
          <input type="number" id="open" name="status[open]" value="<%- status.open %>" min="0" class="form-control" required>
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="team">Team</label>
        <div class="col-sm-9 team">
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="projectName">Project</label>
        <div class="col-sm-9 project">
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="scriptId">Script</label>
        <div class="col-sm-9 scripts">
        </div>
      </div>

      <div class="form-group">
        <label class="col-sm-2 control-label" for="boundingBox">Bounding Box</label>
        <div class="col-sm-9">
          <span class="help-block hints"></span>
          <input
            type="text"
            id="boundingBox"
            name="boundingBox"
            placeholder="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
            pattern="(\\s*\\d+\\s*,){5}(\\s*\\d+\\s*)"
            title="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
            value="<%- boundingBoxString() %>"
            class="form-control"
          >
        </div>
      </div>

      <div class="subview"></div>

      <div class="form-group">
        <div class="col-sm-2 col-sm-offset-9">
          <button id="submit" type="submit" class="form-control btn btn-primary"><%- getActionName() %></button>
        </div>
      </div>

    </form>
  </div>
  </div>
</div>\
`);

    this.prototype.regions = {
      taskType: ".taskType",
      team: ".team",
      project: ".project",
      scripts: ".scripts",
      subview: ".subview",
    };

    this.prototype.events = { submit: "submit" };

    this.prototype.ui = {
      form: "#createForm",
      status_open: "#status_open",
      boundingBox: "#boundingBox",
      submitButton: "#submit",
    };
  }

  templateContext() {
    return {
      type: this.type,
      isEditingMode: this.isEditingMode,
      getInstanceLabel: () => (this.isEditingMode ? "Remaining Instances" : "Task Instances"),
      boundingBoxString() {
        if (!this.boundingBox) {
          return "";
        }
        const b = this.boundingBox;
        return `${b.topLeft.join(", ")}, ${b.width}, ${b.height}, ${b.depth}`;
      },

      getActionName: () => this.getActionName(),
    };
  }

  initialize(options) {
    this.type = options.type;
    this.isEditingMode = _.isString(this.model.id);

    if (this.isEditingMode) {
      this.listenTo(this.model, "sync", this.render);
      this.model.fetch();
    }
  }

  getActionName() {
    if (this.isEditingMode) {
      return "Update";
    } else {
      return "Create";
    }
  }

  // Submit form data as json
  submit(event) {
    this.toggleSubmitButton(true);

    // send form data to server
    this.createSubview.submit(event);
  }

  toggleSubmitButton(state) {
    if (this.ui.submitButton.prop != null) {
      this.ui.submitButton.prop("disabled", state);
      this.ui.submitButton.toggleClass("disabled", state);
    }
  }

  serializeForm() {
    const formValues = FormSyphon.serialize(this.ui.form);

    formValues.status.inProgress = this.model.get("status").inProgress;
    formValues.status.completed = this.model.get("status").completed;
    formValues.boundingBox = this.parseBoundingBox(formValues.boundingBox);

    return formValues;
  }

  parseBoundingBox(string) {
    if (_.isEmpty(string)) {
      return null;
    }

    // split string by comma delimiter, trim whitespace and cast to integer
    // access from subview
    const intArray = Utils.stringToNumberArray(string);

    return {
      topLeft: [intArray[0] || 0, intArray[1] || 0, intArray[2] || 0],
      width: intArray[3] || 0,
      height: intArray[4] || 0,
      depth: intArray[5] || 0,
    };
  }

  showSaveSuccess(response) {
    const successCount = response.items.filter(item => item.status === 200).length;
    if (successCount === response.items.length) {
      Toast.success(
        `${successCount} tasks were successfully ${this.getActionName().toLowerCase()}d.`,
      );
      const csvContent = response.items
        .map(
          ({ success: task }) => `${task.id},${task.creationInfo},(${task.editPosition.join(",")})`,
        )
        .join("\n");
      Modal.show(`<pre>taskId,filename,position\n${csvContent}</pre>`, "Task IDs");
    } else {
      Toast.error(
        `${response.items.length - successCount}/${response.items
          .length} tasks weren't ${this.getActionName().toLowerCase()}d.`,
      );
    }
    this.toggleSubmitButton(false);
  }

  showSaveError() {
    this.toggleSubmitButton(false);
    Toast.error(
      `The task could not be ${this.getActionName().toLowerCase()}d due to server errors.`,
    );
  }

  showInvalidData() {
    Toast.error("The form data is not correct.");
  }

  /*
   Render the SelectionViews based on the stored options.
   Create a subview based on the passed type: from_form/ from_nml
  */
  onRender() {
    this.taskTypeSelectionView = new SelectionView({
      collection: new TaskTypeCollection(),
      childViewOptions: {
        modelValue() {
          return `${this.model.get("id")}`;
        },
        modelLabel() {
          return `${this.model.get("summary")}`;
        },
        defaultItem: { id: this.model.get("type.id") || Utils.getUrlParamValue("taskType") },
      },
      data: "amIAnAdmin=true",
      name: "taskTypeId",
    });

    const defaultScriptId = this.model.get("script") ? this.model.get("script").id : null;
    this.scriptSelectionView = new SelectionView({
      collection: new ScriptCollection(),
      childViewOptions: {
        modelValue() {
          return `${this.model.get("id")}`;
        },
        modelLabel() {
          return `${this.model.get("name")}`;
        },
        defaultItem: { id: defaultScriptId },
      },
      data: "amIAnAdmin=true",
      name: "scriptId",
      emptyOption: true,
    });

    this.teamSelectionView = new SelectionView({
      collection: new TeamCollection(),
      childViewOptions: {
        modelValue() {
          return `${this.model.get("name")}`;
        },
        defaultItem: { name: this.model.get("team") },
      },
      data: "amIAnAdmin=true",
      name: "team",
    });

    this.projectSelectionView = new SelectionView({
      collection: new ProjectCollection(),
      childViewOptions: {
        modelValue() {
          return `${this.model.get("name")}`;
        },
        defaultItem: {
          name: this.model.get("projectName") || Utils.getUrlParamValue("projectName"),
        },
      },
      data: "amIAnAdmin=true",
      name: "projectName",
      required: true,
    });

    // render subviews in defined regions
    this.showChildView("taskType", this.taskTypeSelectionView);
    this.showChildView("team", this.teamSelectionView);
    this.showChildView("project", this.projectSelectionView);
    this.showChildView("scripts", this.scriptSelectionView);

    // get create-subview type
    if (this.type === "from_form") {
      this.createSubview = new TaskCreateFromFormView({ model: this.model, parent: this });
    } else if (this.type === "from_nml") {
      this.createSubview = new TaskCreateFromNMLView({ model: this.model, parent: this });
    } else {
      throw Error(`Type ${this.type} is not defined. Choose between "from_form" and "from_nml".`);
    }

    // render the create-subview
    this.showChildView("subview", this.createSubview);
  }
}
TaskCreateFromView.initClass();

export default TaskCreateFromView;
