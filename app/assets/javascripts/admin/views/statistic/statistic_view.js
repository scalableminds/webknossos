import _ from "lodash";
import Marionette from "backbone.marionette";
import TimeStatisticModel from "admin/models/statistic/time_statistic_model";
import GraphView from "./graph_view";
import StatisticListView from "./statistic_list_view";
import AchievementView from "./achievement_view";

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

  initialize() {

    app.router.showLoadingSpinner()

    const timeStatisticModel = new TimeStatisticModel();
    timeStatisticModel.fetch({
      data: "interval=week",
    });

    this.graphView = new GraphView({ model: timeStatisticModel });
    this.achievementView = new AchievementView({ model: timeStatisticModel });
    this.statisticListView = new StatisticListView();

    this.listenTo(timeStatisticModel, "sync", this.showGraphView);
    this.listenTo(this, "render", this.showStatisticsListView);
  }


  showStatisticsListView() {

    this.showChildView("timings", this.statisticListView);
  }


  showGraphView() {
    this.showChildView("graph", this.graphView);
    this.showChildView("achievements", this.achievementView);
    app.router.hideLoadingSpinner()
  }
}
StatisticView.initClass();


export default StatisticView;
