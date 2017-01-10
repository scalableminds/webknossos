import _ from "lodash";
import $ from "jquery";
import Toast from "libs/toast";
import TeamCollection from "admin/models/team/team_collection";
import ModalView from "admin/views/modal_view";

class TeamRoleModalView extends ModalView {
  static initClass() {
    this.prototype.headerTemplate = "<h3>Assign teams</h3>";
    this.prototype.footerTemplate = `\
<a href="#" class="btn btn-primary">Set Teams</a>
<a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>\
`;
    this.prototype.bodyTemplate = _.template(`\
<header>
  <h4 class="col-sm-8" for="teams">Teams</h4>
  <h4 class="col-sm-4" for="role">Role</h4>
</header>
<div class="row-fluid">
  <% items.forEach(function(team) { %>
    <div class="col-sm-8">
      <div class="checkbox">
        <label>
          <input data-teamname="<%- team.name %>" type="checkbox" value="<%- team.name %>" <%- isChecked(team.name) %>>
            <%- team.name %>
          </option>
        </label>
      </div>
    </div>
    <div class="col-sm-4">
      <div>
        <select data-teamname="<%- team.name %>" name="role" class="form-control">
          <option value="">Modify roles...</option>
            <% _.each(team.roles, function(role) { %>
              <option value="<%- role.name %>" <%- isSelected(team.name, role.name) %>><%- role.name %></option>
            <% }) %>
        </select>
      </div>
    </div>
  <% }) %>
</div>\
`);

    this.prototype.events =
      { "click .btn-primary": "changeExperience" };
  }

  templateContext() {
    // If only one user is selected then prefill the modal with his current values
    let users;
    return {
      isChecked: (teamName) => {
        users = this.getSelectedUsers();
        if (users.length === 1) {
          if (_.find(users[0].get("teams"), { team: teamName })) {
            return "checked";
          }
        }
      },

      isSelected: (teamName, roleName) => {
        users = this.getSelectedUsers();
        if (users.length === 1) {
          const team = _.find(users[0].get("teams"), { team: teamName });
          if (team && team.role.name === roleName) {
            return "selected";
          }
        }
      },
    };
  }

  initialize(options) {
    this.collection = new TeamCollection();
    this.listenTo(this.collection, "sync", this.render);
    this.listenTo(this, "add:child", this.prefillModal);

    this.collection.fetch({
      data: "amIAnAdmin=true",
    });
    this.userCollection = options.userCollection;
    this.selectedUsers = this.getSelectedUsers();
  }


  getSelectedUsers() {
    const checkboxes = $("tbody input[type=checkbox]:checked");
    return checkboxes.map((i, element) => this.userCollection.findWhere({ id: $(element).val() }),
    );
  }


  changeExperience() {
    if (this.isValid()) {
      // Find all selected users that will be affected by the bulk action
      $("tbody input[type=checkbox]:checked").each(
        (i, userEl) => {
          const user = this.userCollection.findWhere({
            id: $(userEl).val(),
          });

          // Find all selected teams
          let teams = _.map(this.$("input[type=checkbox]:checked"), (selectedTeamEl) => {
            const teamName = $(selectedTeamEl).data("teamname");
            return {
              team: $(selectedTeamEl).val(),
              role: {
                name: this.$(`select[data-teamname="${teamName}"] :selected`).val(),
              },
            };
          },
          ) || [];

          // Find unselected teams
          const removedTeamsNames = _.map(this.$("input[type=checkbox]:not(:checked)"), (unselectedTeamEl) => {
            $(unselectedTeamEl).data("teamname");
          }) || [];

          // Add / remove teams
          const teamNames = _.map(teams, "team");
          for (const oldTeam of user.get("teams")) {
            if (!(teamNames.includes(oldTeam.team))) {
              teams.push(oldTeam);
            }
          }
          teams = _.filter(teams,
            team => !_.includes(removedTeamsNames, team.team));

          // Verify user and update his teams
          user.save({
            isActive: true,
            teams,
          });
        },
      );

      return this.hide();
    } else {
      return Toast.error("No role is selected!");
    }
  }


  isValid() {
    let isValid = true;

    // Make sure that all selected checkboxes have a selected role
    this.$("input[type=checkbox]:checked").parent().parent().find("select :selected")
      .each((i, element) => { isValid &= $(element).text() !== "Modify roles..."; });

    return isValid;
  }
}
TeamRoleModalView.initClass();


export default TeamRoleModalView;
