import _ from "lodash";
import Backbone from "backbone";

class TeamModel extends Backbone.Model {
  static initClass() {

      this.prototype.urlRoot  = "/api/teams";

      this.prototype.defaults  = {
        name : "",
        owner : "",
        roles : [
            {name : "admin"},
            {name : "user"}
        ],
        isEditable : "true"
      };
    }
}
TeamModel.initClass();

export default TeamModel;
