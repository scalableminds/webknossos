# Applies an affine transformation matrix on an array of points.
M4x4.transformPointsAffine = (m, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  m00 = m[0]
  m01 = m[1]
  m02 = m[2]
  m10 = m[4]
  m11 = m[5]
  m12 = m[6]
  m20 = m[8]
  m21 = m[9]
  m22 = m[10]
  m30 = m[12]
  m31 = m[13]
  m32 = m[14]

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m00 * v0 + m10 * v1 + m20 * v2 + m30
    r[i + 1] = m01 * v0 + m11 * v1 + m21 * v2 + m31
    r[i + 2] = m02 * v0 + m12 * v1 + m22 * v2 + m32

  r

# Applies a transformation matrix on an array of points.
M4x4.transformPoints = (m, points, r = new MJS_FLOAT_ARRAY_TYPE(points.length)) ->

  for i in [0...points.length] by 3
    v0 = points[i]
    v1 = points[i + 1]
    v2 = points[i + 2]
    
    r[i]     = m[0] * v0 + m[4] * v1 + m[8] * v2 + m[12]
    r[i + 1] = m[1] * v0 + m[5] * v1 + m[9] * v2 + m[13]
    r[i + 2] = m[2] * v0 + m[6] * v1 + m[10] * v2 + m[14]
    w        = m[3] * v0 + m[7] * v1 + m[11] * v2 + m[15]

    if w != 1.0
      r[0] /= w
      r[1] /= w
      r[2] /= w

  r


M4x4.inverse = (mat, dest = new MJS_FLOAT_ARRAY_TYPE(16)) ->
  # cache matrix values
  a00 = mat[0]
  a01 = mat[1]
  a02 = mat[2]
  a03 = mat[3]
  a10 = mat[4]
  a11 = mat[5]
  a12 = mat[6]
  a13 = mat[7]
  a20 = mat[8]
  a21 = mat[9]
  a22 = mat[10]
  a23 = mat[11]
  a30 = mat[12]
  a31 = mat[13]
  a32 = mat[14]
  a33 = mat[15]
  b00 = a00 * a11 - a01 * a10
  b01 = a00 * a12 - a02 * a10
  b02 = a00 * a13 - a03 * a10
  b03 = a01 * a12 - a02 * a11
  b04 = a01 * a13 - a03 * a11
  b05 = a02 * a13 - a03 * a12
  b06 = a20 * a31 - a21 * a30
  b07 = a20 * a32 - a22 * a30
  b08 = a20 * a33 - a23 * a30
  b09 = a21 * a32 - a22 * a31
  b10 = a21 * a33 - a23 * a31
  b11 = a22 * a33 - a23 * a32

  # calculate determinant
  invDet = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06)

  dest = []
  dest[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet
  dest[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet
  dest[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet
  dest[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet
  dest[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet
  dest[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet
  dest[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet
  dest[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet
  dest[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet
  dest[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet
  dest[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet
  dest[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet
  dest[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet
  dest[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet
  dest[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet
  dest[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet

  return dest

M4x4.extractTranslation = (m, r = new MJS_FLOAT_ARRAY_TYPE(3)) ->
  r[0] = m[12]
  r[1] = m[13]
  r[2] = m[14]
  r

V3.round = (v, r = new MJS_FLOAT_ARRAY_TYPE(3)) ->
  r[0] = Math.round(v[0])
  r[1] = Math.round(v[1])
  r[2] = Math.round(v[2])
  r

V3.toString = (v) ->
  "#{v[0]},#{v[1]},#{v[2]}"

$.bindDeferred = (target, source) ->
  source
    .done(-> target.resolve.apply(target, arguments))
    .fail(-> target.reject.apply(target, arguments))
    .progress(-> target.notify.apply(target, arguments))


_.debounceOrThrottleDeferred = (func, waitDebounce, waitThrottle) ->

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

_.debounceDeferred = (func, wait) ->
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
_.throttle2 = (func, wait, resume = true) ->
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
_.mutexDeferred = (func, timeout = 20000) ->

  deferred = null

  (args...) ->

    unless deferred
      
      deferred = _deferred = func.apply(this, args)
      unless timeout < 0
        setTimeout((-> 
          deferred = null if deferred == _deferred
        ), timeout) 
      deferred.always -> deferred = null
      deferred

    else
      $.Deferred().reject("mutex").promise()

# Removes the first occurrence of given element from an array.
_.removeElement = (array, element) ->
  if (index = array.indexOf(element)) != -1
    array.splice(index, 1)

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

