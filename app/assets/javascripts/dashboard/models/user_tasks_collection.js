/**
 * user_tasks_collection.js
 * @flow weak
 */

import SortedCollection from "admin/models/sorted_collection";
import Backbone from "backbone";
import DashboardTaskModel from "dashboard/models/dashboard_task_model";

const NEW_TASK_URL = "/user/tasks/request";

class UserTasksCollection extends SortedCollection {
  isFinished: boolean;
  userID: string;

  static initClass() {
    // If you know how to do this better, do it. Backbones Model type is not compatible to Marionettes
    // Model type according to flow - although they actually should be...
    this.prototype.model = ((DashboardTaskModel: any): Backbone.Model);
    this.prototype.defaults = { showFinishedTasks: false };
  }

  url() {
    if (this.userID) {
      return `/api/users/${this.userID}/tasks?isFinished=${this.isFinished.toString()}`;
    }
    return `/api/user/tasks?isFinished=${this.isFinished.toString()}`;
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
      url: NEW_TASK_URL,
      success: () => this.add(newTask),
    });
  }
}
UserTasksCollection.initClass();

export default UserTasksCollection;
