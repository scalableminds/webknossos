import SortedCollection from "admin/models/sorted_collection";
import DatasetModel from "admin/models/dataset/dataset_model";

class DatasetCollection extends SortedCollection {
  static initClass() {
    this.prototype.url = "/api/datasets";
    this.prototype.model = DatasetModel;
    this.prototype.sortAttribute = "name";
  }
}
DatasetCollection.initClass();

export default DatasetCollection;
