### define
underscore : _
backbone : Backbone
./dashboard_task_model : DashboardTaskModel
./user_model : UserModel
admin/models/dataset/dataset_collection : DatasetCollection
dashboard/models/logged_time_model : LoggedTimeModel
###

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


  getFinishedTasks : ->

    return @get("tasks")


  getUnfinishedTasks : ->

    filteredTasks = @get("tasks").filter( (task) -> return !task.get("annotation").state.isFinished )
    return new Backbone.Collection(filteredTasks)


  transformToCollection : ->

    tasks = @get("taskAnnotations").map( (el) ->
      return DashboardTaskModel::parse(el)
    )

    tasks = new Backbone.Collection(tasks, model : DashboardTaskModel )
    @set("tasks", tasks)

    exploratoryAnnotations = new Backbone.Collection()
    # Display newst first.
    exploratoryAnnotations.add(@get("exploratoryAnnotations"))
    exploratoryAnnotations.comparator = (a,b) ->
      console.log(a.get("formattedHash")," : ", a.get("created"), " < ", b.get("created"), " : ", b.get("formattedHash"))
      return a.get("created") < b.get("created")
    exploratoryAnnotations.sort()

    @set("exploratoryAnnotations", exploratoryAnnotations)


  getNewTask : ->

    newTask = new DashboardTaskModel()

    return newTask.fetch(
      url : @newTaskUrl
      success : (response) =>
        @get("tasks").add(newTask)
    )

