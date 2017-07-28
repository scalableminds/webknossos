import _ from "lodash";
import Marionette from "backbone.marionette";
import app from "app";
import GraphView from "admin/views/statistic/graph_view";
import StatisticListView from "admin/views/statistic/statistic_list_view";
import AchievementView from "admin/views/statistic/achievement_view";

class StatisticView extends Marionette.View {
  static initClass() {
    this.prototype.className = "statistics container wide";
    this.prototype.template = _.template(`\
<div class="row-fluid">
  <div class="col-sm-8">
    <div class="graph well"></div>
    <div class="timings well"></div>
  </div>
  <div class="achievements col-sm-4 well">

  </div>
</div>\
`);

    this.prototype.regions = {
      graph: ".graph",
      timings: ".timings",
      achievements: ".achievements",
    };
  }

  initialize(options) {
    const timeStatisticModel = options.model;

    this.listenTo(timeStatisticModel, "sync", this.showGraphView);
    this.listenTo(timeStatisticModel, "request", () => app.router.showLoadingSpinner());
    this.listenTo(this, "render", this.showStatisticsListView);

    timeStatisticModel.fetch({
      data: "interval=week",
    });

    this.graphView = new GraphView({ model: timeStatisticModel });
    this.achievementView = new AchievementView({ model: timeStatisticModel });
    this.statisticListView = new StatisticListView();
  }

  showStatisticsListView() {
    this.showChildView("timings", this.statisticListView);
  }

  showGraphView() {
    this.showChildView("graph", this.graphView);
    this.showChildView("achievements", this.achievementView);
  }
}
StatisticView.initClass();

export default StatisticView;
