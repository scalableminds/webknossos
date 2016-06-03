$ = require("jquery")
_ = require("lodash")
Backbone = require("backbone")

class BaseRouter

  $mainContainer : null
  routes : {}

  constructor : ->
    _.extend(this, Backbone.Events)
    @activeViews = []
    @routes = _.map(@routes, (handler, route) =>
      {
        route: Backbone.Router::_routeToRegExp(route),
        handler: if _.isString(handler) then this[handler].bind(this) else handler
      }
    )
    window.addEventListener("popstate", @handlePopstate)
    window.addEventListener("beforeunload", @handleBeforeunload)

    @setupClickHandler()

    @currentURL = window.location.pathname + window.location.search + window.location.hash
    _.defer( => @handleRoute())


  setupClickHandler : ->
    # handle all links and manage page changes (rather the reloading the whole site)
    $(document).on "click", "a", (evt) =>

      url = $(evt.currentTarget).attr("href") or ""

      if newWindow = $(evt.target).data("newwindow")
        [ width, height ] = newWindow.split("x")
        window.open(url, "_blank", "width=#{width},height=#{height},location=no,menubar=no")
        evt.preventDefault()
        return

      # disable for links beginning with #
      if url.indexOf("#") == 0
        return

      # allow opening links in new tabs
      if evt.metaKey or evt.ctrlKey
        return

      # allow target=_blank etc
      if evt.currentTarget.target != ""
        return

      for { route } in @routes
        if url.match(route)
          evt.preventDefault()
          @navigate(url)

          return
      return


  handlePopstate : (event) =>
    # Remember: URL is already changed

    if not @shouldNavigate(window.location.pathname)
      # Do nothing
      return

    # Check for beforeunload
    beforeunloadValue = @triggerBeforeunload()
    if beforeunloadValue? and not confirm(beforeunloadValue + "\nDo you wish to navigate away?")
      # Rollback to previous URL
      window.history.pushState({}, document.title, @currentURL)
      return

    @navigate(window.location.pathname, { trigger: false })
    return


  handleRoute : =>

    baseUrl = @getBaseUrl()

    for { route, handler } in @routes
      match = baseUrl.match(route)
      if match
        args = Backbone.Router::_extractParameters(route, baseUrl)
        handler.apply(null, args)
        return
    return


  getBaseUrl : ->

    # Return the baseUrl without urlParams or anchors/hashes
    baseUrl = @currentURL.replace(/\?.*$/, "").replace(/#.*$/, "")
    return baseUrl


  shouldNavigate : (path) ->
    return @getBaseUrl() != path


  navigate : (path, { trigger = true } = {}) ->
    if not @shouldNavigate(path)
      # Do nothing
      return

    if trigger
      beforeunloadValue = @triggerBeforeunload()
      if beforeunloadValue? and not confirm(beforeunloadValue + "\nDo you wish to navigate away?")
        return
      window.history.pushState({}, document.title, path)
    @currentURL = path

    if @cleanupViews()
      _.defer(@handleRoute)
    return


  handleBeforeunload : (e) =>
    beforeunloadValue = @triggerBeforeunload()
    if beforeunloadValue?
      e.returnValue = beforeunloadValue
    return


  triggerBeforeunload : =>

    # Triggers the registered `beforeunload` handlers and returns the first return value
    # Doesn't use Backbone's trigger because we need return values
    handlers = this._events?.beforeunload ? []
    beforeunloadValue = _.find(
      handlers.map((handler) => handler.callback.call(handler.ctx)),
      (value) => value?)
    return beforeunloadValue


  cleanupViews : ->

    # Remove current views
    if @activeViews.length > 0
      for view in @activeViews
        # prefer Marionette's.destroy() function to Backbone's remove()
        if view.destroy
          view.destroy()
        else
          view.remove()

        if view.forcePageReload
          window.removeEventListener("beforeunload", @handleBeforeunload)
          @reload()
          return false
      @activeViews = []

    else
      # we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      @$mainContainer.empty()

    return true


  loadURL : (url) ->

    window.location.href = url
    return


  reload : ->

    window.location.reload()
    return

module.exports = BaseRouter
