import _ from "lodash";
import Marionette from "backbone.marionette";
import c3 from "c3";
import LoggedTimeListView from "./logged_time_list_view";
import LoggedTimeCollection from "../models/logged_time_collection";


class LoggedTimeView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<h3>Tracked Time</h3>
<div class="row">
  <div class="col-sm-10">
    <div id="time-graph"></div>
  </div>
  <div class="col-sm-2">
    <div class="time-table"></div>
  </div>
  <% if (items.length == 0) { %>
    <h4>Sorry. We don't have any time logs for you. Trace something and come back later</h4>
  <% } %>
</div>\
`);

    this.prototype.regions =
      { timeTable: ".time-table" };
  }


  initialize(options) {
    this.options = options
    this.collection = new LoggedTimeCollection([], { userID: this.options.userID });
    this.listenTo(this.collection, "sync", this.render);
    return this.collection.fetch();
  }


  onRender() {
    if (this.collection.length > 0) {
      this.showChildView("timeTable", new LoggedTimeListView({ collection: this.collection }));
      return _.defer(() => this.addGraph());
    }
  }


  addGraph() {
    // Only render the chart if we have any data.
    if (this.collection.length > 0) {
      const dates = this.collection.map(item => item.get("interval").toDate());
      const monthlyHours = this.collection.map(item => item.get("time").asHours());

      const graph = c3.generate({
        bindto: "#time-graph", // doesn't work with classes
        data: {
          x: "date",
          columns: [
            ["date"].concat(dates),
            ["monthlyHours"].concat(monthlyHours),
          ],
        },
        axis: {
          x: {
            type: "timeseries",
            tick: {
              format: "%Y %m",
            },
          },
          y: {
            label: "minutes / month",
          },
        },
        legend: {
          show: false,
        },
      });
    }
  }


  serializeData() {
    return { items: this.serializeCollection(this.collection) };
  }
}
LoggedTimeView.initClass();

export default LoggedTimeView;
