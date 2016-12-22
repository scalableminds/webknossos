import Backbone from "backbone";

class TaskOverviewCollection extends Backbone.Collection {
  static initClass() {
  
    this.prototype.url  = "/api/statistics/assignments";
  }
}
TaskOverviewCollection.initClass();


export default TaskOverviewCollection;
