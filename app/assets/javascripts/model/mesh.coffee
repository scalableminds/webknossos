### define 
libs/request : request
###

# This loads and caches meshes.

Mesh = 

  get : _.memoize (name) ->

    request(
      url : "/assets/mesh/#{name}"
      responseType : 'arraybuffer'
    ).pipe (data) ->
      
      # To save bandwidth meshes are transferred in a binary format.
      header  = new Uint32Array(data, 0, 4)
      vertices = new Float32Array(data, 16, header[0])
      colors   = new Float32Array(data, 16 + 4 * header[0], header[1])
      normals = new Float32Array(data, 16 + 4 * (header[0] + header[1]), header[2])
      indices  = new Uint16Array(data, 16 + 4 * (header[0] + header[1] + header[2]), header[3])  

      { vertices, colors, indices, normals }