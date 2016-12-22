import _ from "lodash";
import app from "app";
import Request from "libs/request";
import Marionette from "backbone.marionette";
import TeamCollection from "admin/models/team/team_collection";
import ModalView from "admin/views/modal_view";


class TeamAssignmentModalView extends ModalView {
  static initClass() {
  
    this.prototype.headerTemplate  = "<h3>Assign teams for this dataset</h3>";
    this.prototype.bodyTemplate  = _.template(`\
<ul name="teams" class="team-list">
  <% items.forEach(function(team) { %>
    <li>
      <div class="checkbox">
        <label>
          <input type="checkbox" value="<%- team.name %>" <%- isChecked(team.name) %>>
          <%- team.name %>
        </label>
      </div>
    </li>
  <% }) %>
</ul>\
`);
    this.prototype.footerTemplate  = `\
<a class="btn btn-primary">Save</a>
<a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>\
`;
  
    this.prototype.ui  =
      {"teamList" : ".team-list"};
  
    this.prototype.events  =
      {"click .btn-primary" : "submitTeams"};
  }

  templateContext() {
    return {
      isChecked : teamName => {
        if (_.includes(this.dataset.get("allowedTeams"), teamName)) {
          return "checked";
        }
      }
    };
  }


  initialize(args) {

    this.collection = new TeamCollection();
    this.listenTo(this.collection, "sync", this.render);
    this.collection.fetch({
      data : "isEditable=true"
    });

    return this.dataset = args.dataset;
  }


  submitTeams() {

    const $checkboxes = this.$("input:checked");
    const allowedTeams = _.map($checkboxes, checkbox => $(checkbox).parent().parent().text().trim());

    this.dataset.set("allowedTeams", allowedTeams);

    Request.sendJSONReceiveJSON(
      `/api/datasets/${this.dataset.get("name")}/teams`,
      {data: allowedTeams}
    );

    return this.destroy();
  }
}
TeamAssignmentModalView.initClass();


export default TeamAssignmentModalView;
