import SortedCollection from "../sorted_collection";
import DatasetModel from "./dataset_model";

class DatasetCollection extends SortedCollection {
  static initClass() {
  
    this.prototype.url  = "/api/datasets";
    this.prototype.model  = DatasetModel;
    this.prototype.sortAttribute  = "name";
  }
}
DatasetCollection.initClass();

export default DatasetCollection;
