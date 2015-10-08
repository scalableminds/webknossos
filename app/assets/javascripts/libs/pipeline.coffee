$ = require("jquery")
_ = require("underscore")


class Pipeline

  # Executes asnychronous actions in order.
  #
  # Each action is executed after the previous action
  # is finished. Any output of the previous action is
  # passed to the current action.


  constructor : (firstArguments, @options = {}) ->

    @actions       = []
    @nextArguments = firstArguments
    @retryCount    = 0
    @running       = false
    @failed        = false

    _.defaults @options,
      maxRetry : 3
      retryTimeMs : 1000


  executeAction : (action) ->
    # action : function that returns a
    #          $.Deferred object

    action._deferred = new $.Deferred()
    @actions.push( action )

    if not @running
      @executeNext()

    return action._deferred


  executePassAlongAction : (action) ->
    # For actions that don't return anything

    newAction = ->
      args = arguments
      action(args...).pipe ->
        # TODO: Figure out how to pass along all arguments
        return args[0]

    return @executeAction(newAction)


  executeActions : (actionList) ->

    for action in actionList
      deferred = @executeAction(action)
    return deferred


  restart : ->
    # To restart the pipeline after it failed.
    # Returns a new Deferred for the first item.

    if @failed and @actions.length > 0
      @failed = false
      @retryCount = 0
      @running = false

      # Reinsert first action
      return @executeAction(@actions.shift())

    return new $.Deferred().resolve()


  executeNext : =>

    currentAction = @actions.shift()

    if currentAction?

      @running = true

      currentAction(@nextArguments...)
        .done (response) =>

          currentAction._deferred.resolve(arguments...)

          @nextArguments = arguments
          @retryCount = 0
          @executeNext()

        .fail (response) =>

          @retryCount++
          @actions.unshift(currentAction)

          if @retryCount >= @options.maxRetry
            @failed = true
            currentAction._deferred.reject(arguments...)
          else
            setTimeout(@executeNext, @options.retryTimeMs)

    else

      @running = false

module.exports = Pipeline
