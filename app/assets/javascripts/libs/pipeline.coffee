_ = require("lodash")
Deferred = require("./deferred")


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


  isBusy : ->

    return @actions.length != 0


  getLastActionPromise : ->

    if @actions.length == 0
      return Promise.resolve()

    return @actions[@actions.length - 1]._deferred.promise()


  executeAction : (action) ->
    # action : function that returns a `Promise`

    action._deferred = new Deferred()
    @actions.push( action )

    if not @running
      @executeNext()

    return action._deferred.promise()


  executePassAlongAction : (action) ->
    # For actions that don't return anything

    newAction = ->
      args = arguments
      action(args...).then ->
        # TODO: Figure out how to pass along all arguments
        return args[0]

    return @executeAction(newAction)


  executeActions : (actionList) ->

    for action in actionList
      promise = @executeAction(action)
    return promise


  restart : ->
    # To restart the pipeline after it failed.
    # Returns a new Promise for the first item.

    if @failed and @actions.length > 0
      @failed = false
      @retryCount = 0
      @running = false

      # Reinsert first action
      return @executeAction(@actions.shift())

    return Promise.resolve()


  executeNext : =>

    currentAction = @actions.shift()

    if currentAction?

      @running = true

      currentAction(@nextArguments...).then(
        (response) =>

          currentAction._deferred.resolve(response)

          @nextArguments = arguments
          @retryCount = 0
          @executeNext()

        (response) =>

          @retryCount++
          @actions.unshift(currentAction)

          if @retryCount >= @options.maxRetry
            @failed = true
            currentAction._deferred.reject(response)
          else
            setTimeout(@executeNext, @options.retryTimeMs)
      )

    else

      @running = false

module.exports = Pipeline
