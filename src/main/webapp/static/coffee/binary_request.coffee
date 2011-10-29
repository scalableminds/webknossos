binary_request = (url, callback) ->

  xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)
  xhr.responseType = 'arraybuffer'
  
  xhr.onload = ->
    if @status == 200
      callback(null, @response)
    else
      callback(@statusText)
      
  xhr.onerror = (e) ->
    callback(e)
    
  xhr.send()