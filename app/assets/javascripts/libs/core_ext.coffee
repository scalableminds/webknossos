$           = require("jquery")
Backbone    = require("backbone")
_           = require("lodash")
Request     = require("libs/request")


$.bindDeferred = (target, source) ->

  source
    .done(-> target.resolve.apply(target, arguments))
    .fail(-> target.reject.apply(target, arguments))
    .progress(-> target.notify.apply(target, arguments))


_.mixin(

  toCamelCase : (string) ->

    "#{string[0].toLowerCase}#{string.substring(1)}"


  debounceOrThrottleDeferred : (func, waitDebounce, waitThrottle) ->

    timeoutDebounce = null
    deferred = null
    throttled = false

    ->
      context = this
      args = arguments

      deferred.reject() if deferred
      deferred = $.Deferred()

      caller = ->
        result = func.apply(context, args)
        setTimeout(unthrottler, waitThrottle)
        throttled = true
        if result
          $.bindDeferred(deferred, result)
        else
          deferred.reject()


      unthrottler = ->
        throttled = false


      debouncer = ->
        timeoutDebounce = null
        caller()


      clearTimeout(timeoutDebounce)
      if throttled
        timeoutDebounce = setTimeout(debouncer, waitDebounce)
      else
        caller()

      deferred.promise()


  debounceDeferred : (func, wait) ->

    timeout = null
    deferred = null
    ->
      context = this
      args = arguments

      deferred.reject() if deferred
      deferred = $.Deferred()

      later = ->

        timeout = null
        result = func.apply(context, args)
        if result
          $.bindDeferred(deferred, result)
        else
          deferred.reject()

      clearTimeout(timeout)
      timeout = setTimeout(later, wait)

      deferred.promise()


  # `_.throttle2` makes a function only be executed once in a given
  # time span -- no matter how often you it. We don't recomment to use
  # any input parameters, because you cannot know which are used and
  # which are dropped. In contrast to `_.throttle`, the function
  # at the beginning of the time span.
  throttle2 : (func, wait, resume = true) ->

    timeout = more = false

    ->
      context = @
      args = arguments
      if timeout == false
        _.defer -> func.apply(context, args)
        timeout = setTimeout (
          ->
            timeout = false
            func.apply(context, args) if more
            more = false
          ), wait
      else
        more = resume and true


  # Returns a wrapper function that rejects all invocations while an
  # instance of the function is still running. The mutex can be
  # cleared with a predefined timeout. The wrapped function is
  # required to return a `$.Deferred` at all times.
  mutexDeferred : (func, timeout = 20000) ->

    deferred = null

    (args...) ->

      unless deferred

        deferred = _deferred = func.apply(this, args)
        unless timeout < 0
          setTimeout((->
            deferred = null if deferred == _deferred
          ), timeout)
        deferred.then(
          -> deferred = null
          -> deferred = null
        )
        deferred

      else
        $.Deferred().reject("mutex").promise()

  # Removes the first occurrence of given element from an array.
  removeElement : (array, element) ->

    if (index = array.indexOf(element)) != -1
      array.splice(index, 1)

)


# Works like `$.when`. However, there is a notification when one
# of the deferreds completes.
# http://api.jquery.com/jQuery.when/
$.whenWithProgress = (args...) ->

  sliceDeferred = [].slice
  length = args.length
  pValues = new Array( length )
  firstParam = args[0]
  count = length
  pCount = length
  deferred = if length <= 1 && firstParam && jQuery.isFunction( firstParam.promise )
      firstParam
    else
      jQuery.Deferred()
  promise = deferred.promise()


  resolveFunc = ( i ) ->

    ( value ) ->
      args[ i ] = if arguments.length > 1 then sliceDeferred.call( arguments, 0 ) else value
      if !( --count )
        deferred.resolveWith( deferred, args )
      # This is new
      else
        deferred.notifyWith( deferred, args )


  progressFunc = ( i ) ->

    ( value ) ->
      pValues[ i ] = if arguments.length > 1 then sliceDeferred.call( arguments, 0 ) else value
      deferred.notifyWith( promise, pValues )


  if length > 1
    for i in [0...length]
      if args[ i ] && args[ i ].promise && jQuery.isFunction( args[ i ].promise )
        args[ i ].promise().then( resolveFunc(i), deferred.reject, progressFunc(i) )
      else
        --count
    unless count
      deferred.resolveWith( deferred, args )
  else if deferred != firstParam
    deferred.resolveWith( deferred, if length then [ firstParam ] else [] )
  promise


###
 *jQuery alterClass plugin
 *
 * Remove element classes with wildcard matching. Optionally add classes:
 *   $( '#foo' ).alterClass( 'foo-* bar-*', 'foobar' )
 *
 * Copyright (c) 2011 Pete Boere (the-echoplex.net)
 * Free under terms of the MIT license: http://www.opensource.org/licenses/mit-license.php
*
*###

$.fn.alterClass = ( removals, additions ) ->

  self = this

  if removals.indexOf( '*' ) == -1
    # Use native jQuery methods if there is no wildcard matching
    self.removeClass( removals )
    return if not additions  then self else self.addClass( additions )


  patt = new RegExp( '\\s' +
    removals.
    replace( /\*/g, '[A-Za-z0-9-_]+' ).
    split( ' ' ).
    join( '\\s|\\s' ) + '\\s', 'g' );

  self.each( ( i, it ) ->
    cn = ' ' + it.className + ' '
    while ( patt.test( cn ) )
      cn = cn.replace( patt, ' ')

    it.className = $.trim( cn )
  )

  return if not additions then self else self.addClass( additions )


# changes Backbone ajax to use Request library instead of jquery ajax
Backbone.ajax = (options) ->

  # Backbone uses the data attribute for url parameters when performing a GET request
  if options.data? and options.type == "GET"
    if _.isString(options.data)
      options.url += "?#{options.data}"
      delete options.data

    else if _.isObject(options.data)
      params = _.map(options.data, (value, key) -> return "#{key}=#{value}").join("&")
      options.url += "?#{params}"

      delete options.data
    else
      throw new Error("options.data is expected to be a string or object for a GET request!")

  return Request.$(Request.sendJSONReceiveJSON(
    options.url
    method : options.type
    data : options.data
  ))
    # Needs to be done/fail because we don't care about the return value of the callbacks
    .done(options.success)
    .fail(options.error)
