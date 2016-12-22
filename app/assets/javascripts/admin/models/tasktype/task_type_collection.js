import _ from "lodash";
import TaskTypeModel from "./task_type_model";
import SortedCollection from "../sorted_collection";

class TaskTypeCollection extends SortedCollection {
  static initClass() {
  
    this.prototype.url  = "/api/taskTypes";
    this.prototype.model  = TaskTypeModel;
    this.prototype.sortAttribute  = "summary";
  }

  parse(responses) {

    return _.map(responses, TaskTypeModel.prototype.parse);
  }


  addJSON(item) {

    [item] = this.parse([item]);
    return this.add(item);
  }
}
TaskTypeCollection.initClass();

export default TaskTypeCollection;
