#!/usr/bin/python

from utility import *
import struct


vertices = []
textures = []
colors = []
vertexNormals = []

''' per face '''
vertexIndex = []
texturesIndex = []
normalsIndex = []


''' Load a wavefront obj 3D file and parses it. It outputs the parsed
values as a stream of binary interpretation. Output as Javascript arrays
optional.
The method is far from complete.

Features:
- vertex parsing
- vertex coloring based on command line input (or list of preset colors)
- normal parsing
- optional: surface normals, vertex normals calculation 
- Texture coordinate parsing (NOT TESTED)

TODO: 
- Material file parsing (*.mtl files)
'''
def parseObjFile(objFile, options):
    print "converting %s" % objFile
    myfile = open(objFile, "r")


    global vertices
    global textures
    global colors
    global vertexIndex
    global vertexNormals
    global texturesIndex
    global normalsIndex

    vertices = []
    textures = []
    colors = []
    vertexIndex = []
    vertexNormals = []
    texturesIndex = []
    normalsIndex = []


    # SPLIT ON LINE ENDS
    lines = myfile.read().split('\n')
    lines = filter(lambda x: len(x) > 0,[x.strip() for x in lines])

    # SHOULD BE RESET AT THE FIRST OCCURRENCE OF A "g" TAG
    currentColor = 0

    for line in lines:    
        # HANDLE SUBGROUPS
        if line[0] == 'g':
            ''' TODO: proper support for grouping
            FOR RIGHT NOW LETS HAVE SOME FUN WITH COLORS
            either use a user provided color or choose from a number predefined ones '''
            if len(options.color) == 0:
                if currentColor < 11:
                    currentColor+=1
                else:
                    currentColor = 0
                
        # HANDLE NORMALS
        if line[0:2] == "vn":
            vertexNormals.append( map(float,spacereg.split(line)[1:]) )

        # HANDLE TEXTURES
        elif line[0:2] == "vt":
            textures.append( map(float,spacereg.split(line)[1:]) )
            
        # HANDLE VERTICES
        elif line[0] == "v":
            vertices.append( map(float,spacereg.split(line)[1:]) )
            if len(options.color) > 0:
                colors.append( options.color )
            else:
                colors.append( COLORS[currentColor] )

            # ASSOCIATE FACES TO VERTICES AND NORMALS 
            # SUBTRACT 1 BECAUSE BUFFER INDEX STARTS AT 0
        elif line[0] == "f":
            fac = spacereg.split(line)[1:]
            # HANDLE faces
            if len(fac) == 3:
                for block in fac:
                    verts = [int(x) if len(x)>0 else None for x in slashreg.split(block) ]
                    # VERTEX INDEX
                    vertexIndex.append(verts[0] - 1)
                    # TEXTURE INDEX
                    if len(verts) > 1 and verts[1] != None:
                        texturesIndex.append(verts[1] - 1)
                    # NORMAL INDEX
                    if len(verts) > 2 and verts[2] != None:
                        normalsIndex.append(verts[2] - 1)
                
            # HANDLE QUADS / POLYGONS
            # triangulate face worth more than three vertices
            else:
                polygonFaces = []
                polygonTextures = []
                polygonNormals = []
                for block in fac:
                    verts = [int(x) if len(x)>0 else None for x in slashreg.split(block) ]
                    # VERTEX INDEX
                    polygonFaces.append(verts[0]-1) 
                    if len(verts) > 1 and verts[1] != None:
                        polygonTextures.append(verts[1] - 1)
                    # NORMAL INDEX
                    if len(verts) > 2 and verts[2]!= None:
                        polygonNormals.append(verts[2] - 1)
                # ADD NEW FACES
                vertexIndex += triangulate(polygonFaces)
                texturesIndex += triangulate(polygonTextures)
                normalsIndex += triangulate(polygonNormals)
        else:
            pass


    '''Calculate the vertex normals if the 3d model does not provide any.
    If it already comes with normals explicitly assotiat every normal to its
    vertex. Why? Well, I rather have larger binary files than do the array lookup
    for every normal during runtime.'''
    if len(vertexIndex) != len(normalsIndex) or len(vertexNormals) == 0:
        calcVertexNormals()
        #because some vertices are referred to more than once
        vertexNormals = [vertexNormals[index] for index in vertexIndex]
    else:
        vertexNormals = [vertexNormals[index] for index in normalsIndex]


    ''' Flatten all the list and loose the "vector" structure. This is necassary 
    in order to properly export everything.
    Btw, yes I know all of these 3 arrays have the same length and could therefore be 
    iterated over in one loop. :-)
    ''' 
    vertices = [number for vertex in vertices for number in vertex]
    vertexNormals = [number for normal in vertexNormals for number in normal]
    colors = [number for color in colors for number in color]

    ''' Binary Output '''
    output = open(objFile[:-4], 'wb')
    output.write(struct.pack('IIII', len(vertices), len(colors), len(vertexNormals), len(vertexIndex)))    
    output.write(struct.pack('f' * len(vertices), *vertices))
    output.write(struct.pack('f' * len(colors), *colors))
    output.write(struct.pack('f' * len(vertexNormals), *vertexNormals))
    output.write(struct.pack('H' * len(vertexIndex), *vertexIndex))

    output.close()

    print "%s written" % objFile[:-4]

    ''' JS Output '''
    if options.JsOutput:
        output = open(objFile[:-4]+'.js','w')
        output.write("vertices=" + str(vertices) + ";\n")
        output.write("vertexIndex=" + str(vertexIndex) + ";\n")
        output.write("colors=" + str(colors)+ ";\n")
        output.write("vertexNormals=" + str(vertexNormals) + ";\n")
        output.close()

        print "%s.js written" % objFile[:-4]

        
'''Divide a polygon into triangles'''
def triangulate(l):
    triangles = []    
    for i in range(1,len(l)-1):
        triangles.append(l[0])
        triangles.append(l[i])
        triangles.append(l[i + 1])
    return triangles

'''Calculate the surface normals of a tringle depending on its 
three vertices.
Clock-wise orientatino of the vertices is assumed.
3D Math primer page 254'''
def calcSurfaceNormals(vec1, vec2, vec3):
    edge1 = V3.subtract(vec2, vec1) 
    edge2 = V3.subtract(vec3, vec2)

    cross = V3.cross(edge1, edge2)
    normal = V3.divide(cross, V3.length(cross))
    return normal

'''Calculate vertex normals by averaging the surface normals of the surrounding
triangles of a vertex

TODO An offset can be used to weigh the neighbouring triangles in order to increase
the visual experience (i.e. have "realer" normals ) '''
def calcVertexNormals():
    global vertexNormals
    vertexNormals = []
    _faces = facesFromFacesIndex()

    for vertex in vertices:
        normal = [0,0,0]

        for face in _faces:
            if vertex in face:
                normal = V3.add(normal, calcSurfaceNormals(*face) )
        
        vertexNormals.append(V3.normalize(normal))

''' This little helper returns a list of all faces. Each face is an array of it 3d vectors.'''
def facesFromFacesIndex():
    _faces = []

    for i in range(0,len(vertexIndex) -1, 3):
        triangle = []

        for j in range(0,3):
            triangle.append( vertices[vertexIndex[i+j]] )

        _faces.append(triangle)

    return _faces


'''MAIN 
Load all *.obj files in a given director (including sub dirs) or
open single specified *.obj file.'''
def main():
    options = parseCommandLine()
    ''' either load specified file or scan a directory for obj files '''
    if options.path[-3:] == "obj":
         parseObjFile(options.path, options)
    else:
        for objFile in locate("*.obj", options.path):
            parseObjFile(objFile, options)

if __name__ == '__main__':
    main()

