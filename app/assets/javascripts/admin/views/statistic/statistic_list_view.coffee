### define
underscore : _
backbone.marionette : marionette
app : app
moment : moment
./statistic_list_item_view : StatisticListItemView
admin/models/statistic/user_statistic_collection : UserStatisticCollection
###

class StatisticListView extends Backbone.Marionette.CompositeView

  template : _.template("""
    <h3>Best Tracers for week <%= startDate.format("DD.MM") %> - <%= endDate.format("DD.MM.YYYY") %></h3>
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

  itemView : StatisticListItemView
  itemViewContainer: "tbody"

  initialize : ->

    #set first day of the week to monday globally
    moment.lang("en", week : dow : 1)

    @model = new Backbone.Model()
    @model.set(
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
      reset : true
    )
