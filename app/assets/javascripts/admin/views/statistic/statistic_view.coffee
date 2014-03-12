### define
underscore : _
backbone.marionette : marionette
app : app
./graph_view : GraphView
./statistic_list_view : StatisticListView
###

class StatisticView extends Backbone.Marionette.Layout

  className : "statistics container wide"
  template : _.template("""
    <h3>Statistics</h3>
    <div class="row-fluid">
      <div class="span8">
        <div class="graph"></div>
        <div class="timings"></div>
      </div>
      <div class="achievements span4 well">
        <h4>Achievements</h4>
        <table class="table">
          <tbod>
            <tr>
              <td>Overall Time</td>
              <td>234:99h</td>
            </tr>
            <tr>
              <td>Overall Tracings</td>
              <td>2,34cm</td>
            </tr>
            <tr>
              <td>Average Branchpoints</td>
              <td>33</td>
            </tr>
            <tr>
              <td>Finished Tasks</td>
              <td>23433</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  """)

  regions :
    "graph" : ".graph"
    "timings" : ".timings"

  initialize : ->

    @graphView = new GraphView()
    @statisticListView = new StatisticListView()

    @listenTo(@, "render", @afterRender)


  afterRender : ->

    @graph.show(@graphView)
    @timings.show(@statisticListView)


