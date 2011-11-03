describe 'model', ->

  it 'should exist', ->
    expect(Model).toBeDefined()
  
  it 'should have loaded coordinateModel', ->
    async 'never initialized', (done) ->
      
      Model.wait 'initialized', ->
        coordinatesModel = Model.__test.coordinatesModel
        expect(coordinatesModel).toBeDefined()
        expect(coordinatesModel.length % 3).toEqual(0)
        done()

  
  describe 'find', ->
    
    it 'should load some points', ->
      async 'never completed loading', (done) ->
        
        model = new _Model(true)
        model.find [0,0,0], [0,1,0], (err, data) ->
          expect(err).toBeNull()
          expect(data).toBeDefined()
          expect(data).toBeA(Uint8Array)
          expect(data.length).toBeGreaterThan(0)
          done()

  
  describe 'rotateAndMove', ->
    
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
      async 'rotateAndMove never completed', (done) ->
        model = new _Model(true)
        model.__test.coordinatesModel = testModel
        model.rotateAndMove [1,2,3], [0,1,0], (data) ->
          
          correct = [0,2,2,0,2,3,0,2,4,1,2,2,1,2,3,1,2,4,2,2,2,2,2,3,2,2,4,0,3,2,0,3,3,0,3,4,1,3,2,1,3,3,1,3,4,2,3,2,2,3,3,2,3,4,0,4,2,0,4,3,0,4,4,1,4,2,1,4,3,1,4,4,2,4,2,2,4,3,2,4,4]
          
          expect(data).toBeSameArrayAs correct
          done()

    it 'should be able to rotate model', ->
      async "rotateAndMove never completed", (done) ->
        
        model = new _Model(true)
        model.__test.coordinatesModel = testModel
        model.rotateAndMove [0,0,0], [1,2,3], (data) ->
          
          correct = [-1,1,0,-1,0,0,-1,-1,1,0,1,-1,0,0,0,0,-1,1,1,1 ,-1,1,0,0,1,-1,0,-1,2,0,-1,1,1,-1,0,2,0,1,0,0,1,1,0,0,1,1,1,0,1,0,1,1,-1,1,0,2,1,0,1,2,-1,1,2,1,2,1,1,1,2,0,0,2,2,2,1,1,1,1,1,0,2]
          
          expect(data).toBeSameArrayAs correct
          done()

    it 'should rotate independent of the rotating vectors size', ->
      async 'rotateAndMove never completed', (done) ->
      
        model = new _Model(true)
        model.__test.coordinatesModel = testModel
        model.rotateAndMove [0,0,0], [1,2,3], (data) ->
          model.rotateAndMove [0,0,0], [2,4,6], (data1) ->
            expect(data1).toBeSameArrayAs data
            done()