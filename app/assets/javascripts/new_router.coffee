$ = require("jquery")
_ = require("lodash")
Backbone = require("backbone")

class NewRouter

  $mainContainer : null
  routes : {}

  constructor : ->
    _.extend(this, Backbone.Events)
    @routes = _.map(@routes, (handler, route) =>
      {
        route: Backbone.Router::_routeToRegExp(route),
        handler: if _.isString(handler) then this[handler].bind(this) else handler
      }
    )
    window.addEventListener("popstate", @handlePopstate)
    window.addEventListener("beforeunload", @handleBeforeunload)

    @setupClickHandler()

    _.defer( => @navigate(window.location.pathname, { trigger: false }))


  setupClickHandler : ->
    # handle all links and manage page changes (rather the reloading the whole site)
    $(document).on "click", "a", (evt) =>

      url = $(evt.currentTarget).attr("href") or ""
      urlWithoutSlash = url.replace(/^\//, "")

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
        if urlWithoutSlash.match(route)
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

    urlWithoutSlash = @currentURL.replace(/^\//, "")
    for { route, handler } in @routes
      match = urlWithoutSlash.match(route)
      if match
        args = Backbone.Router::_extractParameters(route, urlWithoutSlash)
        handler.apply(null, args)
        return
    return

  shouldNavigate : (path) ->
    return @currentURL != path

  navigate : (path, { trigger=true } = {}) ->
    if not @shouldNavigate(path)
      # Do nothing
      return

    @currentURL = path
    if trigger
      beforeunloadValue = @triggerBeforeunload()
      if beforeunloadValue? and not confirm(beforeunloadValue + "\nDo you wish to navigate away?")
        return
      window.history.pushState({}, document.title, path)

    @cleanupViews()
    _.defer(@handleRoute)


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


  cleanupViews : (path) ->

    beforeunloadValue = @triggerBeforeunload()
    if beforeunloadValue? and !confirm(beforeunloadValue + "\nDo you wish to navigate away?")
      @off("beforeunload")
      return

    # Remove current views
    if @activeViews
      for view in @activeViews
        # prefer Marionette's.destroy() function to Backbone's remove()
        if view.destroy
          view.destroy()
        else
          view.remove()

        if view.forcePageReload
          window.removeEventListener("beforeunload", @handleBeforeunload)
          @loadURL(path)
          return
      @activeViews = []

    else
      # we are probably coming from a URL that isn't a Backbone.View yet (or page reload)
      @$mainContainer.empty()


  loadURL : (url) ->

    window.location.href = url
    return


  reload : ->

    window.location.reload()
    return

module.exports = NewRouter
