import Backbone from "backbone";
import FormatUtils from "libs/format_utils";

class ScriptModel extends Backbone.Model {
  static initClass() {
    this.prototype.urlRoot = "/api/scripts";

    this.prototype.defaults = {
      gist: "",
      name: "",
    }
  }


  parse(response) {
    response.formattedHash = FormatUtils.formatHash(response.id);

    return response;
  }


  destroy() {
    const options = { url: `/api/scripts/${this.get("id")}` };
    return super.destroy(options);
  }
}
ScriptModel.initClass();

export default ScriptModel;
