#!/usr/bin/python

from utility import *
import struct


def parseObjFile(objFile, options):
    print "converting %s" % objFile
    myfile = open(objFile, "r")

    vertices = []
    textures = []
    colors = []
    faces = []
    normals = []
    texturesPointer = []
    normalsPointer = []

    # SPLIT ON LINE ENDS
    lines = myfile.read().split('\n')
    lines = filter(lambda x: len(x) > 0,[x.strip() for x in lines])

    # SHOULD BE RESET AT THE FIRST OCCURANCE OF A "g" TAG
    currentColor = 12

    for line in lines:    
        # HANDLE SUBGROUPS
        if line[0] == 'g':
            # TODO
            # FOR RIGTH NOW LETS HAVE SOME FUN WITH COLORS
            if currentColor < 11:
                currentColor+=1
                print COLORS[currentColor]
            else:
                currentColor = 0
                
        # HANDLE NORMALS
        if line[0:2] == "vn":
            normals += map(float,spacereg.split(line)[1:]) 
            
        # HANDLE TEXTTURES
        elif line[0:2] == "vt":
            textures += map(float,spacereg.split(line)[1:])
            
        # HANDLE VERTICES    
        elif line[0] == "v":
            vertices += map(float,spacereg.split(line)[1:])
            colors += COLORS[currentColor];

        # ASSOCIATE FACES TO VERTICES AND NORMALS
        # SUBTRACT 1 BECAUSE BUFFER INDEX STARTS AT 0
        elif line[0] == "f":
            fac = spacereg.split(line)[1:]
            # HANDLE TRIANGLES
            if len(fac) == 3:
                for block in fac:
                    verts = [int(x) if len(x)>0 else None for x in slashreg.split(block) ]
                    # VERTEX INDEX
                    faces.append(verts[0] - 1)
                    # TEXTURE INDEX
                    if len(verts) > 1 and verts[1] != None:
                        texturesPointer.append(verts[1] - 1)
                    # NORMAL INDEX
                    if len(verts) > 2 and verts[2] != None:
                        normalsPointer.append(verts[2] - 1)
                
            # HANDLE QUADS / POLYGONS
            # TRIANGULATE    
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
                faces += triangulate(polygonFaces)
                texturesPointer += triangulate(polygonTextures)
                normalsPointer += triangulate(polygonNormals)
        else:
            pass

    output = open(objFile[:-4], 'wb')
    
    if options.colorsEnabled:
        output.write(struct.pack('III', len(vertices), len(colors), len(faces)))
    else:
        output.write(struct.pack('III', len(vertices), len(vertices), len(faces)))
    
    output.write(struct.pack('f' * len(vertices), *vertices))
    
    if options.colorsEnabled:
        output.write(struct.pack('f' * len(colors), *colors))
    else:
        output.write(struct.pack('f' * len(vertices), *([1,0,0] * (len(vertices) / 3))))
    
    output.write(struct.pack('H' * len(faces), *faces))
    
    output.close()

    print "%s written" % objFile[:-4]

    
    output = open(objFile[:-4]+'.js','w')
    output.write("vertices=" + str(vertices) + ";\n")
    output.write("faces=" + str(faces) + ";\n")
    output.write("normals=" + str(normals) + ";\n")
    output.write("normalsPointer=" + str(normalsPointer) + ";\n")
    if options.colorsEnabled:
        output.write("colors=" + str(colors)+ ";\n")
    else:
        output.write("textures=" + str(textures) + ";\n")
        output.write("texturesPointer=" + str(texturesPointer) + ";\n")
    output.close()

    print "%s.js written" % objFile[:-4]

        

def triangulate(l):
    triangles = []    
    for i in range(1,len(l)-1):
        triangles.append(l[0])
        triangles.append(l[i])
        triangles.append(l[i + 1])
    return triangles

def main():
    options = parseCommandLine()
    for objFile in locate("*.obj", options.path):
        parseObjFile(objFile, options)

if __name__ == '__main__':
    main()

