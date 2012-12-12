define [
  "jquery"
  "underscore"
], ($, _) ->

  class Diagnostics

    template : _.template """
      <p>Touches: <% _.each(touches, function (a) { %><%= a.clientX %>x<%= a.clientY %><% }) %></p>
      <p>Sequence: <%= sequence %></p>
      <p>Frame: <%= frameNumber %></p>
    """

    INTERVAL : 200

    constructor : (@el) ->

      @touches = []
      @sequence = ""
      @frameNumber = 0
      @ajaxErrors = []

      @$el = $(el)

      $view = $("<div>", class : "diagnostics")
      @$el.append($view)

      window.setInterval(
        => $view.html(@template(this))
        @INTERVAL
      )


    logTouch : (type, touches) ->
      
      @touches = ({ clientX : t.clientX, clientY : t.clientY } for t in  touches)
      
    logSequence : (id) -> @sequence = id

    logFrameNumber : (frameNumber) -> @frameNumber = frameNumber

    logAjaxError : (error, xhr) ->

      @ajaxErrors.push()