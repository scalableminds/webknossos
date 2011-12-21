describe 'Model.Binary', ->

  it 'should exist', ->
    expect(Model.Binary).toBeDefined()
  
  it 'should have loaded coordinateModel', ->
    async 'never initialized', (done) ->
      
      Model.Binary.lazyInitialize (err) ->
        coordinatesModel = Model.Binary.coordinatesModel
        expect(coordinatesModel).toBeDefined()
        expect(coordinatesModel.length % 3).toEqual(0)
        done()

  
  describe 'get', ->
    
    it 'should load some points', ->
      async 'never completed loading', (done) ->
        
        Model.Binary.get [0,0,0], [0,1,0], (err, coords, colors) ->
          expect(err).toBeNull()
          expect(coords).toBeA(Float32Array)
          expect(colors).toBeA(Float32Array)
          expect(coords.length).toBeGreaterThan(0)
          expect(colors.length).toBeGreaterThan(0)
          done()

  
  describe 'rotateAndTranslate', ->
    
    testModel = new Int8Array(new ArrayBuffer(81))
    i = 0
    for y in [0..2]  
      for x in [-1..1]
        for z in [-1..1]
          testModel[i]   = x
          testModel[i+1] = y
          testModel[i+2] = z
          i += 3
    
    it 'should be able to move model', ->
      async 'rotateAndTranslate never completed', (done) ->
        Model.Binary.rotateAndTranslate testModel, [1,2,3], [0,1,0], (err, data) ->
          
          correct = [0,2,2,0,2,3,0,2,4,1,2,2,1,2,3,1,2,4,2,2,2,2,2,3,2,2,4,0,3,2,0,3,3,0,3,4,1,3,2,1,3,3,1,3,4,2,3,2,2,3,3,2,3,4,0,4,2,0,4,3,0,4,4,1,4,2,1,4,3,1,4,4,2,4,2,2,4,3,2,4,4]
          
          expect(data).toBeSameArrayAs correct
          done()

    it 'should be able to rotate model', ->
      async "rotateAndTranslate never completed", (done) ->
        
        Model.Binary.rotateAndTranslate testModel, [0,0,0], [1,2,3], (err, data) ->
          
          correct = [-1,1,0,-1,0,0,-1,-1,1,0,1,-1,0,0,0,0,-1,1,1,1 ,-1,1,0,0,1,-1,0,-1,2,0,-1,1,1,-1,0,2,0,1,0,0,1,1,0,0,1,1,1,0,1,0,1,1,-1,1,0,2,1,0,1,2,-1,1,2,1,2,1,1,1,2,0,0,2,2,2,1,1,1,1,1,0,2]
          
          expect(_.all(@actual, (el, i) -> Math.round(el) == expected[i])).toBe true
          done()

    it 'should rotate independent of the rotating vectors size', ->
      async 'rotateAndTranslate never completed', (done) ->
      
        Model.Binary.rotateAndTranslate testModel, [0,0,0], [1,2,3], (err, data) ->
          Model.Binary.rotateAndTranslate testModel, [0,0,0], [2,4,6], (err, data1) ->
            expect(data1).toBeSameArrayAs data
            done()

describe 'Model.Mesh', ->

  it 'should load a cube', ->
    async 'get never completed', (done) ->

      Model.Mesh.get 'cube', (err, coords, colors, indexes) ->

        expect(err).toBeNull()
        expect(coords.length).toEqual 8 * 3
        expect(colors.length).toEqual 8 * 3
        expect(indexes.length).toEqual 6 * 2 * 3

        expect(coords).toBeSameArrayAs [0,0,0,0,0,1,0,1,0,0,1,1,1,0,0,1,0,1,1,1,0,1,1,1]

        for i in [0...colors.length] by 3
          expect(colors[i    ]).toEqual 1
          expect(colors[i + 1]).toEqual 0
          expect(colors[i + 2]).toEqual 0
        
        expect(indexes).toBeSameArrayAs [0, 6, 4, 0, 2, 6, 0, 3, 2, 0, 1, 3, 2, 7, 6, 2, 3, 7, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 1, 5, 7, 1, 7, 3]
        done()