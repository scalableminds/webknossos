import Utils from "libs/utils";
import FormatUtils from "libs/format_utils";
import Backbone from "backbone";
import TaskModel from "./task_model";

class TaskCollection extends Backbone.Collection {
  static initClass() {
    this.prototype.model = TaskModel;
  }
  initialize(models, options = {}) {
    this.projectName = options.projectName;
    this.taskTypeId = options.taskTypeId;
  }

  url() {
    if (this.projectName != null) {
      return `/api/projects/${this.projectName}/tasks`;
    } else if (this.taskTypeId != null) {
      return `/api/taskTypes/${this.taskTypeId}/tasks`;
    } else {
      return "/api/queries";
    }
  }

  parse(responses) {
    return responses.map((response) => {
      // apply some defaults
      response.type = {
        summary: Utils.__guard__(response.type, x => x.summary) || "<deleted>",
        id: Utils.__guard__(response.type, x1 => x1.id) || "",
      };

      if (response.tracingTime == null) { response.tracingTime = 0; }
      response.formattedTracingTime = FormatUtils.formatSeconds(response.tracingTime / 1000);

      // convert bounding box
      if (response.boundingBox != null) {
        const { topLeft, width, height, depth } = response.boundingBox;
        response.boundingBox = topLeft.concat([width, height, depth]);
      } else {
        response.boundingBox = [];
      }

      return response;
    });
  }

  addObjects(objects) {
    return this.add(this.parse(objects));
  }
}
TaskCollection.initClass();

export default TaskCollection;
