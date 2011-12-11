describe 'binary_request', ->
  
  it 'should load anything', ->
    async "loading never completed", (done) ->
    
      binary_request '/model/cube', (err, data) ->
        expect(err).toBeNull()
        done()

  it 'should load an arraybuffer', ->
    async "loading never completed", (done) ->
    
      binary_request '/model/cube', (err, data) ->
        expect(data).toBeA(ArrayBuffer)
        done()