Marionette = require("backbone.marionette")

class SelectAllRowsBehavior extends Backbone.Marionette.Behavior

  events :
    "change input.select-all-rows" : "selectAllRows"


  selectAllRows : (evt) ->

    @$el.find("tbody input.select-row").prop("checked", evt.target.checked)
    return

module.exports = SelectAllRowsBehavior
