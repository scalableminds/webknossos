Layer         = require("./layer")
Request       = require("../../../../libs/request")
ErrorHandling = require("../../../../libs/error_handling")
Cube          = require("../cube")


class NdStoreLayer extends Layer


  constructor : ->

    super

    unless @dataStoreInfo.typ == "ndstore"
      throw new Error("NDstoreLayer should only be instantiated with ndstore")


  sendToStoreImpl : (batch, getBucketData, token) ->

    throw new Error("NDstore does not currently support sendToStore")


  requestDataToken : ->

    # ndstore uses its own token that is fixed
    Promise.resolve(@dataStoreInfo.accessToken)


  requestFromStoreImpl : (batch, token) ->

    ErrorHandling.assert(batch.length == 1, "Batch length should be 1 for NDstore Layers")

    [bucket] = batch
    bucketSize = bucket.cubeSize

    # ndstore cannot deliver data for coordinates that are out of bounds
    bounds = @clampBucketToMaxCoordinates(bucket)
    url = """#{@dataStoreInfo.url}/ca/#{token}/raw/raw/#{bucket.zoomStep}/
      #{bounds[0]},#{bounds[3]}/
      #{bounds[1]},#{bounds[4]}/
      #{bounds[2]},#{bounds[5]}/"""

    # if at least one dimension is completely out of bounds, return an empty array
    if bounds[0] >= bounds[3] or bounds[1] >= bounds[4] or bounds[2] >= bounds[5]
      return Promise.resolve(new Uint8Array(bucketSize * bucketSize * bucketSize))

    return Request.receiveArraybuffer(url).then(
      (responseBuffer) =>
        # the untyped array cannot be accessed by index, use a dataView for that
        dataView = new DataView(responseBuffer)

        # create a typed uint8 array that is initialized with zeros
        buffer = new Uint8Array(bucketSize * bucketSize * bucketSize)
        bucketBounds = @getMaxCoordinatesAsBucket(bounds, bucket)

        # copy the ndstore response into the new array, respecting the bounds of the dataset
        index = 0
        for z in [bucketBounds[2]...bucketBounds[5]]
          for y in [bucketBounds[1]...bucketBounds[4]]
            for x in [bucketBounds[0]...bucketBounds[3]]
              buffer[z * bucketSize * bucketSize + y * bucketSize + x] = dataView.getUint8(index++)
        return buffer
    )


  clampBucketToMaxCoordinates : ( {position, zoomStep} ) ->

    min = @lowerBoundary
    max = @upperBoundary

    cubeSize = 1 << Cube::BUCKET_SIZE_P + zoomStep

    [ x, y, z ] = position
    return [
      Math.max(min[0], x)
      Math.max(min[1], y)
      Math.max(min[2], z)
      Math.min(max[0], x + cubeSize)
      Math.min(max[1], y + cubeSize)
      Math.min(max[2], z + cubeSize)
    ]


  getMaxCoordinatesAsBucket : (bounds, bucket) ->

    # transform bounds in zoom-step-0 voxels to bucket coordinates between 0 and BUCKET_SIZE_P
    bucketBounds = _.map(bounds, (coordinate) =>
      cubeSize = 1 << Cube::BUCKET_SIZE_P + bucket.zoomStep
      return (coordinate % cubeSize) >> bucket.zoomStep
    )

    # as the upper bound for bucket coordinates is exclusive, the % cubeSize of it is 0
    # but we want it to be 1 << Cube::BUCKET_SIZE_P
    for i in [3..5]
      bucketBounds[i] = bucketBounds[i] or 1 << Cube::BUCKET_SIZE_P

    return bucketBounds


module.exports = NdStoreLayer
