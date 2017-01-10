import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import Marionette from "backbone.marionette";
import moment from "moment";
import UserStatisticCollection from "admin/models/statistic/user_statistic_collection";
import StatisticListItemView from "./statistic_list_item_view";

class StatisticListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.template = _.template(`\
<h3>Best Tracers for week <%- startDate.format("DD.MM") %> - <%- endDate.format("DD.MM.YYYY") %></h3>
<table class="table-striped table">
  <thead>
    <tr>
      <th>User</td>
      <th>Duration</td>
    </th>
  </thead>
  <tbody></tbody>
</table>\
`);

    this.prototype.childView = StatisticListItemView;
    this.prototype.childViewContainer = "tbody";
  }

  initialize() {
    // set first day of the week to monday globally
    moment.locale("en", { week: { dow: 1 } });

    this.model = new Backbone.Model({
      startDate: moment().startOf("week"),
      endDate: moment().endOf("week"),
    });

    this.collection = new UserStatisticCollection();
    this.fetchData();

    return this.listenTo(app.vent, "graphView:updatedSelection", this.update);
  }


  update(data) {
    this.model.set({
      startDate: moment(data.x),
      endDate: moment(data.x).endOf("week"),
    });
    this.fetchData();
    return this.render();
  }


  toTimestamp(date) {
    return date.unix() * 1000;
  }


  fetchData() {
    return this.collection.fetch({
      data: {
        interval: "week",
        start: this.toTimestamp(this.model.get("startDate")),
        end: this.toTimestamp(this.model.get("endDate")),
        limit: 5,
      },
      reset: true,
    });
  }
}
StatisticListView.initClass();

export default StatisticListView;
