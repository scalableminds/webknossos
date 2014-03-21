### define
jquery : $
underscore : _
backbone : Backbone
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
    "statistics"                    : "statistics"
    "tasks"                         : "tasks"
    "projects"                      : "projects"
    "dashboard"                     : "dashboard"


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

    @showWithPagination("ProjectListView", "ProjectCollection")


  statistics : ->

    @showAdminView("StatisticView")


  datasets : ->

    @showWithPagination("DatasetListView", "DatasetCollection")


  users : ->

    @showWithPagination("UserListView", "UserCollection")


  teams : ->

    @showWithPagination("TeamListView", "TeamCollection")


  tasks : ->

    @showWithPagination("TaskListView", "TaskCollection")


  dashboard : ->

    require ["dashboard/views/dashboard_view"], (Dashboard) =>

      view = new Dashboard()
      @changeView(view)
      

      @hideLoading()


  showWithPagination : (view, collection) ->

    require ["admin/admin"], (admin) =>

      collection = new admin[collection]()
      view = new admin[view](collection: collection)
      paginationView = new admin.PaginationView(collection: collection)

      @changeView(paginationView, view)
      @listenTo(collection, "sync", => @hideLoading())


  showAdminView : (view, collection) ->

    require ["admin/admin"], (admin) =>

      if collection
        collection = new admin[collection]()
        view = new admin[view](collection : collection)
        @listenTo(collection, "sync", => @hideLoading())
      else
        view = new admin[view]()
        @hideLoading()

      @changeView(view)


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
