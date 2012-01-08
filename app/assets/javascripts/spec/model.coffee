describe 'Model.Binary', ->

  it 'should exist', ->
    expect(Model.Binary).toBeDefined()
  
  it 'should pull vertices', ->
    async (done) ->
      
      Model.Binary.pullVertices [1,2,3], [1,2,3], (err, vertices) ->
        expect(vertices).toBeA(Float32Array)
        expect(vertices.length % 3).toEqual(0)
        anyNaN = false
        for n in vertices
          anyNaN = true if _.isNaN(n)
        expect(anyNaN).toBe(false)

        expect(vertices[0]).toBeNearly(-19.276180267333984)
        expect(vertices[1]).toBeNearly(25.122556686401367)
        expect(vertices[2]).toBeNearly(-7.8285393714904785)
        expect(vertices[3]).toBeNearly(-19.415822982788086)
        expect(vertices[4]).toBeNearly(24.32077407836914)
        expect(vertices[5]).toBeNearly(-7.247469425201416)
        expect(vertices[6]).toBeNearly(-19.55546760559082)
        expect(vertices[7]).toBeNearly(23.51898956298828)
        expect(vertices[8]).toBeNearly(-6.666399002075195)

        done()

  
  it 'should get some color values', ->
    async (done) ->
      
      Model.Binary.get [0,0,0,0,1,0], (err, colors) ->
        expect(err).toBeNull()
        expect(colors).toBeA(Float32Array)
        expect(colors.length).toBeGreaterThan(0)
        done()
  
  it 'should expand the data structure', ->
    
    Model.Binary.cube = null
    Model.Binary.extendPoints 80,80,80, 250,250,250

    expect(Model.Binary.cubeSize).toBeSameArrayAs [3,3,3]
    expect(Model.Binary.cubeOffset).toBeSameArrayAs [1,1,1]
    expect(Model.Binary.cube.length).toBe 27
  
  it 'should find the right indices', ->
    
    Model.Binary.cube = null
    Model.Binary.extendPoints 80,80,80, 250,250,250
    
    expect(Model.Binary.pointIndex(80, 80, 80)).toBe 16 * (Model.Binary.BUCKET_WIDTH * (Model.Binary.BUCKET_WIDTH + 1) + 1)
    expect(Model.Binary.bucketIndex(80, 80, 80)).toBe 0
  
  it 'should get and set color values', ->

    Model.Binary.cube = null
    Model.Binary.extendPoints 80,80,80, 250,250,250

    expect(Model.Binary.value(83, 83, 83, 1.5)).toBe 1.5
    expect(Model.Binary.cube[Model.Binary.bucketIndex(83, 83, 83)][Model.Binary.pointIndex(83, 83, 83)]).toBe 1.5
    expect(Model.Binary.value(83, 83, 83)).toBe 1.5


describe 'Model.Trianglesplane', ->

  it 'should generate a plane', ->
    async (done) ->

      Model.Trianglesplane.get 3, 0, (err, vertices, indices) ->

        expect(err).toBeNull()
        expect(vertices).toBeA Uint16Array
        expect(indices).toBeA Uint16Array

        done()

describe 'Model.Mesh', ->

  it 'should load a cube', ->
    async (done) ->

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

describe 'Model.Shader', ->
  it 'should load some shaders', ->
    async (done) ->
      Model.Shader.get 'mesh', (err, vertexShader, fragmentShader) ->

        expect(err).toBeNull()
        expect(vertexShader).toBeA(String)
        expect(fragmentShader).toBeA(String)
        expect(Model.Shader.cache.mesh[0]).toEqual vertexShader
        expect(Model.Shader.cache.mesh[1]).toEqual fragmentShader
        done()

describe 'Interpolation', ->
  
  data = [
    1   # 0,0,0
    1.2 # 1,0,0
    1.3 # 0,1,0
    1.6 # 1,1,0
    1.7 # 0,0,1
    1.8 # 1,0,1
    2   # 0,1,1
    1.1 # 1,1,1
  ]
  getter = (x,y,z) -> data[x + y * 2 + z * 4]
  
  it 'should (sometimes) not interpolate', ->

    expect(interpolate(0, 0, 0, getter)).toBe data[0]
  
  it 'should interpolate linearly', ->

    # 0.8 * 1 + 0.2 * 1.3
    expect(interpolate(0, 0.2, 0, getter)).toBeNearly 1.06 

  it 'should interpolate bilinearly', ->

    # y0 = 0.6 * 1 + 0.4 * 1.2
    # y1 = 0.6 * 1.3 + 0.4 * 1.6
    #    = 0.8 * y0 + 0.2 * y1
    
    # 0.8 * (0.6 * 1 + 0.4 * 1.2) + 0.2 * (0.6 * 1.3 + 0.4 * 1.6)
    expect(interpolate(0.4, 0.2, 0, getter)).toBeNearly 1.148 

  it 'should interpolate trilinearly', ->

    # y0z0 = 0.7 * 1 + 0.3 * 1.2
    # y0z1 = 0.7 * 1.7 + 0.3 * 1.8
    # y1z0 = 0.7 * 1.3 + 0.3 * 1.6
    # y1z1 = 0.7 * 2 + 0.3 * 1.1
    # z0   = 0.4 * y0z0 + 0.6 * y1z0
    # z1   = 0.4 * y0z1 + 0.6 * y1z1
    #      = 0.3 * z0 + 0.7 * z1

    # 0.3 * (0.4 * (0.7 * 1 + 0.3 * 1.2) + 0.6 * (0.7 * 1.3 + 0.3 * 1.6)) +
    # 0.7 * (0.4 * (0.7 * 1.7 + 0.3 * 1.8) + 0.6 * (0.7 * 2 + 0.3 * 1.1))
    expect(interpolate(0.3, 0.6, 0.7, getter)).toBeNearly 1.5884


describe 'M4x4.moveVertices', ->
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
    data = M4x4.moveVertices testModel, [1,2,3], [0,1,0]
      
    correct = [0,2,2,0,2,3,0,2,4,1,2,2,1,2,3,1,2,4,2,2,2,2,2,3,2,2,4,0,3,2,0,3,3,0,3,4,1,3,2,1,3,3,1,3,4,2,3,2,2,3,3,2,3,4,0,4,2,0,4,3,0,4,4,1,4,2,1,4,3,1,4,4,2,4,2,2,4,3,2,4,4]
    
    expect(data).toBeSameArrayAs correct

  it 'should be able to rotate model', ->
    data = M4x4.moveVertices testModel, [0,0,0], [1,2,3]
        
    correct = [-1,1,0,-1,0,0,-1,-1,1,0,1,-1,0,0,0,0,-1,1,1,1,-1,1,0,0,1,-1,0,-1,2,0,-1,1,1,-1,0,2,0,1,0,0,1,1,0,0,1,1,1,0,1,0,1,1,-1,1,0,2,1,0,1,2,-1,1,2,1,2,1,1,1,2,0,0,2,2,2,1,1,1,1,1,0,2]
    
    invalidCount = 0
    for i in [0...data.length]
      invalidCount++ if Math.round(data[i]) != correct[i]
    expect(invalidCount).toBe 0

  it 'should rotate independent of the rotating vectors size', ->
    data = M4x4.moveVertices testModel, [0,0,0], [1,2,3]
    data1 = M4x4.moveVertices testModel, [0,0,0], [2,4,6]
    
    expect(data1).toBeSameArrayAs data
