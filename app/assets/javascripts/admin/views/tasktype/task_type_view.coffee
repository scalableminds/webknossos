_                = require("lodash")
app              = require("app")
marionette       = require("backbone.marionette")
TaskTypeListView = require("./task_type_list_view")
TaskTypeFormView = require("./task_type_form_view")

class TaskTypeView extends Backbone.Marionette.LayoutView

  className : "container task-types-administration"

  template : _.template("""
    <div class="form"></div>
    <div class="list"></div>
  """)

  regions :
    "form" : ".form"
    "list" : ".list"


  initialize : ->

    @listView = new TaskTypeListView(collection : @collection)
    @formView = new TaskTypeFormView(collection : @collection)


  onRender : ->

    @form.show(@formView)
    @list.show(@listView)


module.exports = TaskTypeView
