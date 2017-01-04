import _ from "lodash";
import Backbone from "backbone";
import FormatUtils from "libs/format_utils";

class TaskTypeModel extends Backbone.Model {
  static initClass() {

    this.prototype.urlRoot  = "/api/taskTypes";

    this.prototype.defaults  = {
      summary : "",
      description : "",
      settings : {
        allowedModes : ["flight", "orthogonal", "oblique"],
        branchPointsAllowed : true,
        advancedOptionsAllowed : true,
        somaClickingAllowed : true,
        preferredMode : ""
      },
      expectedTime : {
        min : 300,
        max : 600,
        maxHard : 900
      }
    };
  }


  parse(response) {

    response.formattedHash = FormatUtils.formatHash(response.id);
    response.formattedShortText = FormatUtils.formatShortText(response.description);

    return response;
  }


  destroy() {

    const options = {url : `/api/taskTypes/${this.get('id')}`};
    return super.destroy(options);
  }
}
TaskTypeModel.initClass();

export default TaskTypeModel;
