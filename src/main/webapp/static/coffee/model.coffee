Model = (->
  model = new EventEmitter()
  xhr = new XMLHttpRequest()
  xhr.open('GET', '/model/cube', true)
  xhr.responseType = 'arraybuffer'
  
  coordinatesModel = null
  
  xhr.onload = ->
    if @status == 200
      coordinatesModel = new Int8Array(@response)
      model.emit('initialized')
  
  xhr.onerror = (e) ->
    console.error e
    
  xhr.send()
  
  
  model.find = (point, axis, callback) ->
    find = (point, axis, callback) ->
      xhr = new XMLHttpRequest()
      xhr.open('GET', "/data/cube?px=#{point[0]}&py=#{point[1]}&pz=#{point[2]}&ax=#{axis[0]}&ay=#{axis[1]}&az=#{axis[2]}", true)
      xhr.responseType = 'arraybuffer'
      
      xhr.onload = ->
        if @status == 200
          callback(new UInt8Array(@response))
      
      xhr.send()
      
    if coordinatesModel?
      find(point, axis, callback)
    else
      model.on('initialized', ->
        find(point, axis, callback)
      )
  model
)()