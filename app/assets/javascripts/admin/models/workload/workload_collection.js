import Backbone from "backbone";

class WorkloadCollection extends Backbone.Collection {
  static initClass() {
    this.prototype.url = "/api/tasks/workload";

    this.prototype.state =
      { pageSize: 20 };
  }
}
WorkloadCollection.initClass();

export default WorkloadCollection;
