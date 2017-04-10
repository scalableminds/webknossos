import _ from "lodash";
import ScriptModel from "admin/models/scripts/script_model";
import SortedCollection from "admin/models/sorted_collection";

class ScriptCollection extends SortedCollection {
  static initClass() {
    this.prototype.url = "/api/scripts";
    this.prototype.model = ScriptModel;
    this.prototype.sortAttribute = "summary";
  }

  // parse(responses) {
  //   return _.map(responses, ScriptModel.prototype.parse);
  // }


  // addJSON(item) {
  //   [item] = this.parse([item]);
  //   return this.add(item);
  // }
}
ScriptCollection.initClass();

export default ScriptCollection;
