### define
underscore : _
app : app
backbone.marionette : marionette
./task_type_list_view : TaskTypeListView
./task_type_form_view : TaskTypeFormView
###

class TaskTypeView extends Backbone.Marionette.Layout

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
    @formView = new TaskTypeFormView()


  onRender : ->

    @form.show(@formView)
    @list.show(@listView)

