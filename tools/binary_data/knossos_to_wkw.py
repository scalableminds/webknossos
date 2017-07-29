import itertools
import json
import math
import os
import re

def mortonEncode(x, y, z):
    p = 0
    m = 0
    while x + y + z > 0:
        m |= ((x & 1) << p) | ((y & 1) << (p + 1)) | ((z & 1) << (p + 2))
        x = x >> 1
        y = y >> 1
        z = z >> 1
        p += 3
    return m

def mortonDecode(m):
    p = 0
    x = 0
    y = 0
    z = 0
    while m > 0:
        x |= (m & 1) << p
        m = m >> 1
        y |= (m & 1) << p
        m = m >> 1
        z |= (m & 1) << p
        m = m >> 1
        p += 1
    return x, y, z

def reorganizeInputCube(input, settings):
    buckets = [bytearray() for _ in range(pow(settings['inputCubeSize'] / settings['bucketSize'], 3))]
    bytesPerElement = len(input) / pow(settings['inputCubeSize'], 3)
    offset = 0
    c = 0
    for z in range(settings['inputCubeSize']):
        for y in range(settings['inputCubeSize']):
            for x in range(settings['inputCubeSize'] / settings['bucketSize']):
                data = input[offset:offset + settings['bucketSize'] * bytesPerElement]
                c += len(data)
                bucketIndex = mortonEncode(
                    x,
                    int(y / settings['bucketSize']),
                    int(z / settings['bucketSize'])
                )
                buckets[bucketIndex] += data
                offset += settings['bucketSize'] * bytesPerElement
    return bytearray().join(buckets)

def convertZoomstep(input, output, settings):
    os.makedirs(output)

    # Crawl all raw input files of the zoomStep to
    # a) determinte the datasets size and
    # b) keep a mapping from each file's voxel offset to its filename.
    rawFiles = {}
    rawFileNames = itertools.chain(*map(lambda x: map(lambda y: x[0] + '/' + y, x[2]), os.walk(input)))
    for rawFileName in rawFileNames:
        match = re.search('^.*x(\d+)_y(\d+)_z(\d+)\.raw$', rawFileName)
        if match:
            # Compute voxel offset from filename.
            offset = (
                int(match.group(1)) * settings['inputCubeSize'],
                int(match.group(2)) * settings['inputCubeSize'],
                int(match.group(3)) * settings['inputCubeSize']
            )
            rawFiles[offset] = rawFileName

    # Determine size of the data in voxels.
    inputSize = map(lambda i: (max(map(lambda key: key[i], rawFiles.keys())) + settings['inputCubeSize']), range(3))

    inputCubesPerOutputCube = pow(settings['outputCubeSize'] / settings['inputCubeSize'], 3)
    inputCubeSize = os.stat(rawFiles.values()[0]).st_size
    emptyInputCube = bytearray(inputCubeSize)

    for x in range(0, inputSize[0], settings['outputCubeSize']):
        for y in range(0, inputSize[1], settings['outputCubeSize']):
            for z in range(0, inputSize[2], settings['outputCubeSize']):

                # Create new output cube.
                outputCubeFileName = output + '/%d_%d_%d.raw' % (x, y, z)
                print('Creating output file: "%s"' % outputCubeFileName)
                with open(outputCubeFileName, 'wb') as outputCubeFile:

                    # Loop through all input cubes for the current output cube in morton order.
                    # Each input cube is opened, split into buckets and appended to the output cube.
                    for inputCubeIndex in range(inputCubesPerOutputCube):
                        print '%d/%d' % (inputCubeIndex, inputCubesPerOutputCube)
                        inputCubeCoords = mortonDecode(inputCubeIndex)
                        inputCubeOffset = (
                            x + inputCubeCoords[0] * settings['inputCubeSize'],
                            y + inputCubeCoords[1] * settings['inputCubeSize'],
                            z + inputCubeCoords[2] * settings['inputCubeSize']
                        )

                        if rawFiles.has_key(inputCubeOffset):
                            with open(rawFiles[inputCubeOffset], 'rb') as inputCubeFile:
                                inputCube = inputCubeFile.read()
                                outputSubcube = reorganizeInputCube(inputCube, settings)
                                outputCubeFile.write(outputSubcube)
                        else:
                            # Input cube does not exist -> write an appropriate number of 0-bytes.
                            outputCubeFile.write(emptyInputCube)

settings = {}
settings['bucketSize'] = 32
settings['inputCubeSize'] = 128
settings['outputCubeSize'] = 1024

convertZoomstep('./dataset/color/1', './output/color/1', settings)
