import ScriptModel from "admin/models/scripts/script_model";
import SortedCollection from "admin/models/sorted_collection";

class ScriptCollection extends SortedCollection {
  static initClass() {
    this.prototype.url = "/api/scripts";
    this.prototype.model = ScriptModel;
    this.prototype.sortAttribute = "summary";
  }
}
ScriptCollection.initClass();

export default ScriptCollection;
