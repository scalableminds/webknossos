_                       = require("lodash")
Marionette              = require("backbone.marionette")
app                     = require("app")
moment                  = require("moment")
StatisticListItemView   = require("./statistic_list_item_view")
UserStatisticCollection = require("admin/models/statistic/user_statistic_collection")

class StatisticListView extends Marionette.CompositeView

  template : _.template("""
    <h3>Best Tracers for week <%- startDate.format("DD.MM") %> - <%- endDate.format("DD.MM.YYYY") %></h3>
    <table class="table-striped table">
      <thead>
        <tr>
          <th>User</td>
          <th>Duration</td>
        </th>
      </thead>
      <tbody></tbody>
    </table>
  """)

  childView : StatisticListItemView
  childViewContainer: "tbody"

  initialize : ->

    #set first day of the week to monday globally
    moment.locale("en", week : dow : 1)

    @model = new Backbone.Model(
      startDate : moment().startOf("week")
      endDate : moment().endOf("week")
    )

    @collection = new UserStatisticCollection()
    @fetchData()

    @listenTo(app.vent, "graphView:updatedSelection", @update)


  update : (data) ->

    @model.set(
      startDate : moment(data.x)
      endDate : moment(data.x).endOf("week")
    )
    @fetchData()
    @render()


  toTimestamp : (date) ->

    return date.unix() * 1000


  fetchData : ->

    @collection.fetch(
      data :
        interval : "week"
        start : @toTimestamp(@model.get("startDate"))
        end : @toTimestamp(@model.get("endDate"))
        limit : 5
      reset : true
    )

module.exports = StatisticListView
