### define
underscore : _
###

class PlaylistAdapter

  defaultItem :
    options : 
      enableFrameInterpolation : true


  constructor : (rawPlaylist) ->

    @playlist = rawPlaylist.slice(0)
    @cache = {}
    @graph = null


  adapt : ->

    @defaultize()
    @fixActions()
    @expandComplexActions()
    @resolveImagePatterns()
    @buildCache()
    @buildGraph()

    { @playlist, @cache, @graph }


  defaultize : ->

    for item in @playlist
      _.defaults(item, @defaultItem)
    return


  fixActions : ->

    defaultAction =
      frameRange : [-2, -1]

    for item in @playlist
      if item.endActions
        if item.actions
          item.actions = item.actions.concat(item.endActions)
        else
          item.actions = item.endActions 

      if item.actions
        for action in item.actions
          _.defaults(action, defaultAction)
          action.frameRange = [action.frameRange, action.frameRange] unless _.isArray(action.frameRange)
    return


  expandComplexActions : ->

    newPlaylist = []
    for item in @playlist

      newPlaylist.push(item)

      if item.actions
        for action, i in item.actions when action.images?
          id = "#{item.id}_action#{i}"
          newPlaylist.push(
            id : id
            controller : action.controller ? item.controller
            images : action.images
            next : if action.controller == "SwipableImageStack" then action.next else null # HACK
            actions : [
              { next : action.next }
            ]
            options : item.options
          )
          action.next = id

    @playlist = newPlaylist
    return


  resolveImagePatterns : ->

    for item in @playlist when not _.isArray(item.images)

      pattern = item.images.pattern

      [ replaceSpot, padding ] = pattern.match /\{i:(\d*)\}/
      [ start, end ] = item.images.range

      item.images = for i in [start..end]

        num = i + ""
        num = "0#{num}" while num.length < padding

        pattern.replace(replaceSpot, num)

    return

  buildCache : ->

    for item in @playlist
      @cache[item.id] = item


  buildGraph : ->

    resolveModel = (next) =>

      next = if _.isArray(next)
        [ next[0], next[1] ]
      else
        [ next, null ]

      unless next[0][0] == ":"
        next[0] = @cache[next[0]]

      next


    for item in @playlist
      if item.next?
        item.next = resolveModel(item.next)

      if item.actions?
        for action in item.actions
          action.next = resolveModel(action.next) if action.next?

    @graph = @playlist[0]


