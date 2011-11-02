describe('binary_request', ->
  it('should load anything', ->
    done = false
    
    binary_request('/model/cube', (err, data) ->
      expect(err).toBeNull()
      done = true
    )
    
    waitsFor((-> done), "loading never completed", 5000)
  )
  it('should load an arraybuffer', ->
    done = false
    
    binary_request('/model/cube', (err, data) ->
      expect(data).toBeA(ArrayBuffer)
      done = true
    )
    
    waitsFor((-> done), "loading never completed", 5000)
  )
)