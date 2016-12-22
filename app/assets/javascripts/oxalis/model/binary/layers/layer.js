_             = require("lodash")
BucketBuilder = require("./bucket_builder")
Request       = require("../../../../libs/request")

# Abstract class that defines the Layer interface and implements common
# functionality.
class Layer


  REQUEST_TIMEOUT : 10000


  constructor : (layerInfo, @dataSetName, @dataStoreInfo) ->

    _.extend(this, layerInfo)

    @bitDepth = parseInt(@elementClass.substring(4))
    @tokenPromise = @requestDataToken()


  requestDataToken : ->

    return @tokenRequestPromise if @tokenRequestPromise

    @tokenRequestPromise = Request.receiveJSON(
      "/dataToken/generate?dataSetName=#{@dataSetName}&dataLayerName=#{@name}"
    ).then( (dataStore) =>
      @tokenRequestPromise = null
      return dataStore.token
    )

    return @tokenRequestPromise


  doWithToken : (fn) ->

    return @tokenPromise
        .then(fn)
        .catch((error) =>

          if error.status == 403
            console.warn("Token expired. Requesting new token...")
            @tokenPromise = @requestDataToken()
            return @doWithToken(fn)

          throw error
        )


  buildBuckets : (batch, options) ->

    return batch.map((bucketAddress) ->
      BucketBuilder.fromZoomedAddress(bucketAddress, options))


  # Requests the data, ensures it has the right tokens and resolves with
  # an UInt8Array.
  requestFromStore : (batch, options) ->

    @doWithToken((token) =>
      @requestFromStoreImpl(@buildBuckets(batch, options), token)
    )


  # Sends the batch to the store. `getBucketData(zoomedAddress) -> Uint8Array`
  # converts bucket addresses to the data to send to the server.
  sendToStore : (batch, getBucketData) ->

    @doWithToken((token) =>
      @sendToStoreImpl(@buildBuckets(batch), getBucketData, token)
    )


  requestFromStoreImpl : (batch, token) ->

    throw new Error("Subclass responsibility")


  sendToStoreImpl : (batch, getBucketData, token) ->

    throw new Error("Subclass responsibility")


module.exports = Layer
