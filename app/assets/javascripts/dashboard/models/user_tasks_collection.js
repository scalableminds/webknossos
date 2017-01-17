/**
 * user_tasks_collection.js
 * @flow weak
 */

import SortedCollection from "admin/models/sorted_collection";
import DashboardTaskModel from "./dashboard_task_model";

class UserTasksCollection extends SortedCollection {
  static initClass() {
    this.prototype.model = DashboardTaskModel;
    this.prototype.newTaskUrl = "/user/tasks/request";
    this.prototype.defaults =
        { showFinishedTasks: false };
  }

  url() {
    if (this.userID) {
      return `/api/users/${this.userID}/tasks?isFinished=${this.isFinished}`;
    }
    return `/api/user/tasks?isFinished=${this.isFinished}`;
  }


  initialize(models, options) {
    this.userID = options.userID;
    this.isFinished = options.isFinished || false;
  }


  unfinishedTasksFilter(task) {
    return !task.get("annotation.state.isFinished");
  }


  getNewTask() {
    const newTask = new DashboardTaskModel();

    return newTask.fetch({
      url: this.newTaskUrl,
      success: () => this.add(newTask),
    });
  }
}
UserTasksCollection.initClass();


export default UserTasksCollection;
