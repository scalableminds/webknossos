import _ from "lodash";
import Backbone from "backbone";

class DatastoreModel extends Backbone.Model {
  static initClass() {
  
    this.prototype.urlRoot  = "/api/datastores";
    this.prototype.idAttribute  = "url";
  }
}
DatastoreModel.initClass();

export default DatastoreModel;
