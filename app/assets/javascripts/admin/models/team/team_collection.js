import _ from "lodash";
import TeamModel from "./team_model";
import SortedCollection from "../sorted_collection";

class TeamCollection extends SortedCollection {
  static initClass() {
  
    this.prototype.url  = "/api/teams";
    this.prototype.model  = TeamModel;
    this.prototype.sortAttribute  = "name";
  }
}
TeamCollection.initClass();

export default TeamCollection;
