import Backbone from "backbone";
import DatastoreModel from "./datastore_model";

class DatastoreCollection extends Backbone.Collection {
  static initClass() {
    this.prototype.url = "/api/datastores";
    this.prototype.model = DatastoreModel;
  }
}
DatastoreCollection.initClass();

export default DatastoreCollection;
