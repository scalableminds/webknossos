### define
jquery : $
underscore : _
backbone : Backbone
admin/views/pagination_view : PaginationView
admin/views/dataset/dataset_list_view : DatasetListView
admin/models/dataset/dataset_collection : DatasetCollection
admin/views/user/user_list_view : UserListView
admin/models/user/user_collection : UserCollection
admin/views/team/team_list_view : TeamListView
admin/models/team/team_collection : TeamCollection
admin/views/task/task_list_view : TaskListView
admin/models/task/task_collection : TaskCollection
admin/views/project/project_list_view : ProjectListView
admin/models/project/project_collection : ProjectCollection
###

# #####
# This Router contains all the routes for views that have been
# refactored to Backbone.View yet. All other routes, that require HTML to be
# delivered by the Server are handled by the NonBackboneRouter.
# #####
class Router extends Backbone.Router

  routes :
    "users"                         : "users"
    "teams"                         : "teams"
    "datasets"                      : "datasets"
    "tasks"                         : "tasks"


  initialize : ->


    # handle all links and manage page changes (rather the reloading the whole site)
    $("a").on "click", (evt) =>

      url = $(evt.target).attr("href")
      urlWithoutSlash = url.slice(1)

      if @routes[urlWithoutSlash]
        evt.preventDefault()
        @navigate(url, { trigger: true })

      return

    @$loadingSpinner = $("#loader")
    @$mainContainer = $("#main-container")


  hideLoading : ->

    @$loadingSpinner.hide()


  projects : ->

    @showWithPagination(ProjectListView, ProjectCollection)


  datasets : ->

    @showWithPagination(DatasetListView, DatasetCollection)


  users : ->

    @showWithPagination(UserListView, UserCollection)


  teams : ->

    @showWithPagination(TeamListView, TeamCollection)


  tasks : ->

    @showWithPagination(TaskListView, TaskCollection)


  showWithPagination : (view, collection) ->


    collection = new collection()
    view = new view(collection: collection)
    paginationView = new PaginationView(collection: collection)

    @changeView(paginationView, view)
    @listenTo(collection, "sync", => @hideLoading())


  changeView : (views...) ->

    if @activeViews == views
      return

    @$loadingSpinner.show()

    # Remove current views
    if @activeViews
      for view in @activeViews
        # prefer Marionette's close() function to Backbone's remove()
        if view.close
          view.close()
        else
          view.remove()
    else
      # we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      @$mainContainer.empty()

    # Add new views
    @activeViews = views
    for view in views
      @$mainContainer.append(view.render().el)

    return
