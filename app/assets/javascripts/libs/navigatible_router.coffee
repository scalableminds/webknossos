### define
backbone : Backbone
###

class NavigatibleRouter extends Backbone.Router

  history: []

  navigate: (fragment, options) ->

    @history.push({fragment, options})
    super(fragment, options)

    return @


  historyStart: ->

    @history.push({ fragment: Backbone.history.fragment, options: false })


  hasHistory: ->

    return @history.length >= 2


  previousHistory: ->

    return @history[@history.length-2]


  previous: ->

    console.log(@)
    if @hasHistory()
      {fragment, options} = @previousHistory()
      @navigate(fragment, options)

    return @
