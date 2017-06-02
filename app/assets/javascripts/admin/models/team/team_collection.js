import TeamModel from "admin/models/team/team_model";
import SortedCollection from "admin/models/sorted_collection";

class TeamCollection extends SortedCollection {
  static initClass() {
    this.prototype.url = "/api/teams";
    this.prototype.model = TeamModel;
    this.prototype.sortAttribute = "name";
  }
}
TeamCollection.initClass();

export default TeamCollection;
