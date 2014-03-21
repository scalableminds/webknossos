### define
underscore : _
backbone : Backbone
###

class DashboardModel extends Backbone.Model

  urlRoot : "/getDashboardInfoNew"

  # defaults :
  #   dataSets : ""
  #   exploratory
  #   hasAnOpenTask
  #   loggedTime
  #   tasks
  #   user

  initialize : ->

    @listenTo(@, "sync", @transformToCollection)


  transformToCollection : ->

    @set("tasks", new Backbone.Collection(@get("tasks")))
