_                  = require("lodash")
Backbone           = require("backbone")
DashboardTaskModel = require("./dashboard_task_model")
UserModel          = require("./user_model")
DatasetCollection  = require("admin/models/dataset/dataset_collection")
LoggedTimeModel    = require("dashboard/models/logged_time_model")
SortedCollection   = require("admin/models/sorted_collection")

class DashboardModel extends Backbone.Model

  urlRoot : ->

    if userID = @get("userID")
      return "/api/users/#{userID}/annotations"
    else
      return "/api/user/annotations"


  newTaskUrl : "/user/tasks/request"
  defaults :
      showFinishedTasks : false

  initialize : (options) ->

    @set("tasks", new Backbone.Collection())
    @listenTo(@, "sync", @transformToCollection)


  fetch : ->

    promises = [super(arguments)]

    user = new UserModel(id : @get("userID"))
    @set("user", user)

    promises.push(user.fetch())

    # TODO: decide whether these submodels should be loaded at this time

    @set("dataSets", new DatasetCollection())
    @set("loggedTime", new LoggedTimeModel(userID : @get("userID")))

    return $.when.apply($, promises)


  getTasksFiltered : (isFinished) ->

    filteredTasks = @get("tasks").filter( (task) -> return isFinished == task.get("annotation").state.isFinished )
    return new SortedCollection(filteredTasks)


  getFinishedTasks : ->

    return @getTasksFiltered(true)


  getUnfinishedTasks : ->

    return @getTasksFiltered(false)


  getAnnotations : ->
    @get("allAnnotations")


  createCollection: (name) ->
    collection = new SortedCollection()
    collection.sortBy("created")
    collection.add(@get(name))
    @set(name, collection)


  transformToCollection : ->

    tasks = _.filter(@get("taskAnnotations").map( (el) ->
      return DashboardTaskModel::parse(el)
    ))

    tasks = new SortedCollection(tasks, model : DashboardTaskModel )
    @set("tasks", tasks)

    @createCollection("allAnnotations")


  getNewTask : ->

    newTask = new DashboardTaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success : (response) =>
        @get("tasks").add(newTask)
    )

module.exports = DashboardModel
