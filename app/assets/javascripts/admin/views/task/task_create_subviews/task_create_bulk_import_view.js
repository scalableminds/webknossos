import _ from "lodash";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import Request from "libs/request";
import Modal from "oxalis/view/modal";

class TaskCreateBulkImportView extends Marionette.View {
  constructor(...args) {
    super(...args);
    this.showSaveSuccess = this.showSaveSuccess.bind(this);
  }

  static initClass() {
    this.prototype.id = "create-bulk-import";

    this.prototype.template = _.template(`\
<div class="row">
  <div class="col-sm-12">
    <div class="well">
      One line for each task. The values are seperated by ','. Format: <br>
      dataSet, <a href="/taskTypes">taskTypeId</a>, experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, team, minX, minY, minZ, width, height, depth, project<br><br>
      <form action="" method="POST" class="form-horizontal" onSubmit="return false;">
        <div class="form-group">
          <div class="col-sm-12">
            <textarea class="form-control input-monospace" rows="20" name="data"></textarea>
          </div>
        </div>
        <div class="form-group">
          <div class="col-sm-offset-10 col-sm-2">
            <button type="submit" class="form-control btn btn-primary">
              <i class="fa fa-spinner fa-pulse fa-fw hide"></i>Import
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>\
`);

    this.prototype.events =
      { submit: "submit" };

    this.prototype.ui = {
      bulkText: "textarea[name=data]",
      submitButton: "button[type=submit]",
      submitSpinner: ".fa-spinner",
    };
  }

  /**
    * Submit form data as json.
  */
  submit() {
    const bulkText = this.ui.bulkText.val();

    if (!this.isValidData(bulkText)) {
      this.showInvalidData();
      return false;
    }

    const tasks = this.parseText(bulkText);
    Request.sendJSONReceiveJSON(
      "/api/tasks", {
        params: { type: "bulk" },
        data: tasks,
      },
    ).then(
      this.showSaveSuccess,
      this.showSaveError,
    );

    this.toggleSubmitButton(false);

    // prevent page reload
    return false;
  }


  showSaveSuccess(response) {
    // A succesful request indicates that the bulk syntax was correct. However,
    // each task is processed individually and can fail or succeed.
    if (response.errors) {
      this.handleSuccessfulRequest(response.items);
    } else {
      this.ui.bulkText.val("");
    }
    const successItems = response.items.filter(item => item.status === 200);
    if (successItems.length > 0) {
      Toast.success(`${successItems.length} tasks were successfully created.`);
      const csvContent = successItems.map(({ success: task }) =>
      `${task.id},${task.creationInfo},(${task.editPosition.join(",")})`).join("\n");
      Modal.show(`<pre>taskId,filename,position\n${csvContent}</pre>`, "Task IDs");
    }

    this.toggleSubmitButton(true);
  }


  showSaveError() {
    Toast.error("The tasks could not be created due to server errors.");

    this.toggleSubmitButton(true);
  }


  showInvalidData() {
    Toast.error("The form data is not correct.");
  }


  handleSuccessfulRequest(items) {
    // Remove all successful tasks from the text area and show an error toast for
    // the failed tasks
    const bulkText = this.ui.bulkText.val();
    const tasks = this.splitToLines(bulkText);
    const failedTasks = [];
    let errorMessages = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.status === 400) {
        failedTasks.push(tasks[i]);
        errorMessages.push(item.error);
      }
    }

    // prefix the error message with line numbers
    errorMessages = errorMessages.map((text, i) => `Line ${i} : ${text}`);

    this.ui.bulkText.val(failedTasks.join("\n"));
    Toast.error(errorMessages.join("\n"), true);
  }


  toggleSubmitButton(enabled) {
    this.ui.submitButton.prop("disabled", !enabled);
    this.ui.submitSpinner.toggleClass("hide", enabled);
  }


  splitToLines(string) {
    return string.trim().split("\n");
  }


  splitToWords(string) {
    return string.split(",").map(_.trim);
  }


  isValidData(bulkText) {
    return _.every(this.splitToLines(bulkText), this.isValidLine.bind(this));
  }


  isNull(value) {
    return value === null;
  }


  isValidLine(bulkLine) {
    const bulkData = this.formatLine(bulkLine);
    if (bulkData === null) {
      return false;
    }

    if (_.some(bulkData, this.isNull.bind(this))) {
      return false;
    }

    if (_.some(bulkData.experienceDomain, isNaN) ||
      _.some(bulkData.editPosition, isNaN) ||
      isNaN(bulkData.boundingBox.width) ||
      isNaN(bulkData.boundingBox.height) ||
      isNaN(bulkData.boundingBox.depth) ||
      _.some(bulkData.boundingBox.topLeft, isNaN)) {
      return false;
    }

    return true;
  }


  parseText(bulkText) {
    return _.map(this.splitToLines(bulkText), this.formatLine.bind(this));
  }


  formatLine(bulkLine) {
    const words = this.splitToWords(bulkLine);
    if (words.length < 19) {
      return null;
    }

    const dataSet = words[0];
    const taskTypeId = words[1];
    const experienceDomain = words[2];
    const minExperience = parseInt(words[3]);
    const x = parseInt(words[4]);
    const y = parseInt(words[5]);
    const z = parseInt(words[6]);
    const rotX = parseInt(words[7]);
    const rotY = parseInt(words[8]);
    const rotZ = parseInt(words[9]);
    const instances = parseInt(words[10]);
    const team = words[11];
    const minX = parseInt(words[12]);
    const minY = parseInt(words[13]);
    const minZ = parseInt(words[14]);
    const width = parseInt(words[15]);
    const height = parseInt(words[16]);
    const depth = parseInt(words[17]);
    const projectName = words[18];

    return {
      dataSet,
      team,
      taskTypeId,
      neededExperience: {
        value: minExperience,
        domain: experienceDomain,
      },
      status: {
        open: instances,
        inProgress: 0,
        completed: 0,
      },
      editPosition: [x, y, z],
      editRotation: [rotX, rotY, rotZ],
      boundingBox: {
        topLeft: [minX, minY, minZ],
        width,
        height,
        depth,
      },
      projectName,
      isForAnonymous: false,
    };
  }
}
TaskCreateBulkImportView.initClass();

export default TaskCreateBulkImportView;
