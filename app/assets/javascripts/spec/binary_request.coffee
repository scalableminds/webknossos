describe 'request', ->
  
  it 'should load an arraybuffer', ->
    async (done) ->
    
      request 
        url : '/binary/model/cube'
        responseType : 'arraybuffer'
        ,
        (err, data) ->
          expect(err).toBeNull()
          expect(data).not.toBeNull()
          expect(data).toBeA(ArrayBuffer)
          done()
