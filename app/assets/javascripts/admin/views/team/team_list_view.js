import _ from "lodash";
import Marionette from "backbone.marionette";
import SelectAllRows from "libs/behaviors/select_all_rows_behavior";
import app from "app";
import TeamListItemView from "admin/views/team/team_list_item_view";
import CreateTeamModalView from "admin/views/team/create_team_modal_view";

class TeamListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.template = _.template(`\
 <h3>Teams</h3>
 <table class="table table-striped">
   <thead>
     <tr>
       <th>Name</th>
       <th>Parent</th>
       <th>Owner</th>
       <th>Roles</th>
       <th>Actions</th>
     </tr>
   </thead>
   <tbody></tbody>
 </table>
<div class="modal-wrapper"></div>\
`);

    this.prototype.className = "team-administration container wide";
    this.prototype.childView = TeamListItemView;
    this.prototype.childViewContainer = "tbody";

    this.prototype.behaviors = {
      SelectAllRows: {
        behaviorClass: SelectAllRows,
      },
    };

    this.prototype.ui = { modalWrapper: ".modal-wrapper" };
  }

  initialize() {
    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "modal:destroy", this.render);
    this.listenTo(app.vent, "paginationView:addElement", this.showModal);

    return this.collection.fetch({
      data: "isEditable=true",
    });
  }

  filterBySearch(filterQuery) {
    return this.collection.setFilter(["name", "owner"], filterQuery);
  }

  showModal(modalView) {
    modalView = new CreateTeamModalView({ teamCollection: this.collection });
    this.ui.modalWrapper.html(modalView.render().el);

    return modalView.show();
  }
}
TeamListView.initClass();

export default TeamListView;
