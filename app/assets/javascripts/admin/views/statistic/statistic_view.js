_                  = require("lodash")
Marionette         = require("backbone.marionette")
app                = require("app")
GraphView          = require("./graph_view")
StatisticListView  = require("./statistic_list_view")
AchievementView    = require("./achievement_view")
TimeStatisticModel = require("admin/models/statistic/time_statistic_model")

class StatisticView extends Marionette.View

  className : "statistics container wide"
  template : _.template("""
    <div class="row-fluid">
      <div class="col-sm-8">
        <div class="graph well"></div>
        <div class="timings well"></div>
      </div>
      <div class="achievements col-sm-4 well">

      </div>
    </div>
  """)

  regions :
    "graph" : ".graph"
    "timings" : ".timings"
    "achievements" : ".achievements"

  initialize : ->

    timeStatisticModel = new TimeStatisticModel()
    timeStatisticModel.fetch(
      data : "interval=week"
    )

    @graphView = new GraphView(model : timeStatisticModel)
    @achievementView = new AchievementView(model : timeStatisticModel)
    @statisticListView = new StatisticListView()

    @listenTo(timeStatisticModel, "sync", @showGraphView)
    @listenTo(@, "render", @showStatisticsListView)


  showStatisticsListView : ->

    @showChildView("timings", @statisticListView)


  showGraphView : ->

    @showChildView("graph", @graphView)
    @showChildView("achievements", @achievementView)


module.exports = StatisticView
