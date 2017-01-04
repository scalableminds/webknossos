import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import TeamModel from "admin/models/team/team_model";
import TeamCollection from "admin/models/team/team_collection";
import SelectionView from "admin/views/selection_view";
import ModalView from "admin/views/modal_view";


class CreateTeamModalView extends ModalView {
  static initClass() {
    this.prototype.headerTemplate = "<h3>Add a New Team</h3>";
    this.prototype.bodyTemplate = _.template(`\
<form class="form-horizontal">
  <div class="form-group">
    <label class="col-sm-2 control-label" for="inputName">Name</label>
    <div class="col-sm-10">
      <input type="text" class="form-control" id="inputName" placeholder="Name" required autofocus>
    </div>
  </div>
  <div class="form-group">
    <label class="col-sm-2 control-label" for="inputName">Parent Team</label>
    <div class="col-sm-10 parent-teams">
      <input type="text" class="form-control" id="" placeholder="Name" required>
    </div>
  </div>
</form>\
`);
    this.prototype.footerTemplate = `\
<button type="submit" class="btn btn-primary">Add</button>
<a href="#" class="btn btn-default" data-dismiss="modal">Close</a>\
`;

    this.prototype.ui =
      { inputName: "#inputName" };

    this.prototype.events = {
      "submit form": "addNewTeam",
      "click .btn-primary": "addNewTeam",
    };

    this.prototype.regions =
      { parentTeams: ".parent-teams" };
  }


  initialize(options) {
    this.teamCollection = options.teamCollection;

    return this.teamSelectionView = new SelectionView({
      collection: new TeamCollection(),
      childViewOptions: {
        modelValue() { return `${this.model.get("name")}`; },
      },
      data: "isRoot=true",
    });
  }


  addNewTeam(evt) {
    evt.preventDefault();

    const team = new TeamModel({
      name: this.ui.inputName.val(),
      parent: this.$("select :selected").val(),
    });
    return this.teamCollection.create(team, {
      wait: true,
      success: _.bind(this.destroy, this),
    },
    );
  }


  onRender() {
    return this.showChildView("parentTeams", this.teamSelectionView);
  }
}
CreateTeamModalView.initClass();


export default CreateTeamModalView;
