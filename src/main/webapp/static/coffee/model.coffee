binary_xhr = (url, callback) ->

  xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'arraybuffer'
  
  xhr.onload = ->
    if @status == 200
      success(null, @response)
    else
      error(@responseText)
      
  xhr.onerror = (e) ->
    error(e)
    
  xhr.send()

Model = (->
  model = new EventEmitter()
  coordinatesModel = null
  
  binary_xhr("/model/cube", (err, data) ->
    if err
      model.emit('error', err)
    else
      coordinatesModel = new Int8Array(data)
      model.emit('initialized')
  )
 
  model.find = (point, axis, callback) ->
    find = (point, axis, callback) ->
      
      binary_xhr(
        "/data/cube?px=#{point[0]}&py=#{point[1]}&pz=#{point[2]}&ax=#{axis[0]}&ay=#{axis[1]}&az=#{axis[2]}", 
        (err, data) ->
          if err
            model.emit('error', err)
            callback(err)
          else
            callback(null, new UInt8Array(data))
      )

      
    if coordinatesModel?
      find(point, axis, callback)
    else
      model.on('initialized', ->
        find(point, axis, callback)
      )
  model
)()