import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import SelectAllRows from "libs/behaviors/select_all_rows_behavior";
import TeamRoleModalView from "admin/views/user/team_role_modal_view";
import ExperienceModalView from "admin/views/user/experience_modal_view";
import UserListItemView from "./user_list_item_view";

class UserListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.template = _.template(`\
<h3>Users</h3>
<table class="table table-striped">
  <thead>
    <tr>
      <th>
        <input type="checkbox" class="select-all-rows">
      </th>
      <th>Last name</th>
      <th>First name</th>
      <th>Email</th>
      <th>Experiences</th>
      <th>Teams - Role</th>
      <th class="center-text">Status</th>
      <th></th>
    </tr>
  </thead>
  <tbody></tbody>
</table>
  
<div class="navbar navbar-default navbar-fixed-bottom">
  <div class="navbar-form">
    <div class="btn-group">
      <a class="btn btn-default" id="team-role-modal">
        <i class="fa fa-group"></i>Edit Teams
      </a>
      <a class="btn btn-default" id="experience-modal">
        <i class="fa fa-trophy"></i>Change Experience
      </a>
    </div>
  </div>
</div>
<div id="modal-wrapper"></div>\
`);
    this.prototype.className = "user-administration-table container wide";
    this.prototype.childView = UserListItemView;
    this.prototype.childViewContainer = "tbody";

    this.prototype.ui =
      { modalWrapper: "#modal-wrapper" };

    this.prototype.events = {
      "click #team-role-modal": "showTeamRoleModal",
      "click #experience-modal": "showExperienceModal",
    };

    this.prototype.behaviors = {
      SelectAllRows: {
        behaviorClass: SelectAllRows,
      },
    };
  }

  initialize() {
    this.collection.setPageSize(50);
    this.collection.fetch({
      data: "isEditable=true",
    });

    return this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
  }


  filterBySearch(filterQuery) {
    return this.collection.setFilter(["email", "firstName", "id", "lastName"], filterQuery);
  }


  showTeamRoleModal() {
    return this.showModal(TeamRoleModalView);
  }


  showExperienceModal() {
    return this.showModal(ExperienceModalView);
  }


  showModal(modalView) {
    if (this.$("tbody input[type=checkbox]:checked").length > 0) {
      modalView = new modalView({ userCollection: this.collection });
      modalView.render();
      this.ui.modalWrapper.html(modalView.el);

      modalView.$el.modal("show");
      return this.modalView = modalView;
    } else {
      return Toast.error("No user is selected.");
    }
  }


  onDestroy() {
    return __guard__(this.modalView, x => x.destroy());
  }
}
UserListView.initClass();

export default UserListView;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
