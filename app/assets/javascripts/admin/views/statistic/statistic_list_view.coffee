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

    @collection = new UserStatisticCollection()
    @collection.fetch()

    @listenTo(app.vent, "graphView:updatedSelection", @update)


  update : (data) ->

    timestamp = moment(data.x).format("YYYY-MM-DD")
    @collection.fetch(
      date: timestamp
      reset : true
    )

  render : ->

    super()


