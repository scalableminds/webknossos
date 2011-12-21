describe 'binary_request', ->
  
  it 'should load anything', ->
    async "loading never completed", (done) ->
    
      request 
        url : '/binary/model/cube'
        responseType : 'arraybuffer'
        ,
        (err, data) ->
          expect(err).toBeNull()
          done()

  it 'should load an arraybuffer', ->
    async "loading never completed", (done) ->
    
      request 
        url : '/binary/model/cube'
        responseType : 'arraybuffer'
        ,
        (err, data) ->
          expect(data).toBeA(ArrayBuffer)
          done()