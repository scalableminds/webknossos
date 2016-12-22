_          = require("lodash")
Marionette = require("backbone.marionette")

class StatisticListItemView extends Marionette.View

  tagName : "tr"
  template : _.template("""
    <td><%- user.firstName %> <%- user.lastName %></td>
    <td><%- hours %>h <%- remainingMinutes %>m</td>
  """)


  serializeData : ->

    data = @model.toJSON()

    minutes = data.tracingTimes[0].tracingTime / 1000 / 60
    data.hours = @zeroPad(Math.floor(minutes / 60))
    data.remainingMinutes = @zeroPad(Math.floor(minutes % 60))

    return data


  zeroPad : (number, digits = 2) ->

    number = "" + number
    while number.length < digits
      number = "0#{number}"
    number

module.exports = StatisticListItemView
