import _ from "lodash";
import Marionette from "backbone.marionette";
import app from "app";
import GraphView from "./graph_view";
import StatisticListView from "./statistic_list_view";
import AchievementView from "./achievement_view";
import TimeStatisticModel from "admin/models/statistic/time_statistic_model";

class StatisticView extends Marionette.View {
  static initClass() {
  
    this.prototype.className  = "statistics container wide";
    this.prototype.template  = _.template(`\
<div class="row-fluid">
  <div class="col-sm-8">
    <div class="graph well"></div>
    <div class="timings well"></div>
  </div>
  <div class="achievements col-sm-4 well">
  
  </div>
</div>\
`);
  
    this.prototype.regions  = {
      "graph" : ".graph",
      "timings" : ".timings",
      "achievements" : ".achievements"
    };
  }

  initialize() {

    const timeStatisticModel = new TimeStatisticModel();
    timeStatisticModel.fetch({
      data : "interval=week"
    });

    this.graphView = new GraphView({model : timeStatisticModel});
    this.achievementView = new AchievementView({model : timeStatisticModel});
    this.statisticListView = new StatisticListView();

    this.listenTo(timeStatisticModel, "sync", this.showGraphView);
    return this.listenTo(this, "render", this.showStatisticsListView);
  }


  showStatisticsListView() {

    return this.showChildView("timings", this.statisticListView);
  }


  showGraphView() {

    this.showChildView("graph", this.graphView);
    return this.showChildView("achievements", this.achievementView);
  }
}
StatisticView.initClass();


export default StatisticView;
