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


  # Requests the data, ensures it has the right tokens and resolves with
  # an UInt8Array.
  requestFromStore : (batch, options) ->

    batch = batch.map((bucketAddress) ->
      BucketBuilder.fromZoomedAddress(bucketAddress, options))

    return @tokenPromise.then((token) =>

      @requestImpl(batch, token)

    ).catch((error) =>

        if error.status == 403
          console.warn("Token expired. Requesting new token...")
          @tokenPromise = @requestDataToken()
          return @requestFromStore(batch)

        throw error

    )

  requestImpl : (batch, token) ->

    throw new Error("Subclass responsibility")


module.exports = Layer
