Cube = require("../cube")
_ = require("lodash")

# Converts a zoomed address ([x, y, z, zoomStep] array) into a bucket JSON
# object as expected by the server on bucket request
BucketBuilder = {

  fromZoomedAddress : ([x, y, z, zoomStep], options={}) ->

    bucket = {
      position : [
        x << (zoomStep + Cube::BUCKET_SIZE_P)
        y << (zoomStep + Cube::BUCKET_SIZE_P)
        z << (zoomStep + Cube::BUCKET_SIZE_P)
      ]
      zoomStep : zoomStep
      cubeSize : 1 << Cube::BUCKET_SIZE_P
    }

    bucket = _.extend(bucket, options)

    return bucket


  bucketToZoomedAddress : (bucket) ->

    [x, y, z] = bucket.position
    zoomStep = bucket.zoomStep
    return [
      x >> (zoomStep + Cube::BUCKET_SIZE_P)
      y >> (zoomStep + Cube::BUCKET_SIZE_P)
      z >> (zoomStep + Cube::BUCKET_SIZE_P)
      zoomStep
    ]

}


module.exports = BucketBuilder
