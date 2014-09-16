### define
underscore : _
backbone.marionette : marionette
app : app
./graph_view : GraphView
./statistic_list_view : StatisticListView
./achievement_view : AchievementView
admin/models/statistic/time_statistic_model : TimeStatisticModel
###

class StatisticView extends Backbone.Marionette.LayoutView

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

    @timings.show(@statisticListView)


  showGraphView : ->

    @graph.show(@graphView)
    @achievements.show(@achievementView)


