Layer         = require("./layer")
BucketBuilder = require("./bucket_builder")
Request       = require("../../../../libs/request")
MultipartData = require("../../../../libs/multipart_data")


class WkLayer extends Layer


  constructor : ->

    super

    unless @dataStoreInfo.typ == "webknossos-store"
      throw new Error("WkLayer should only be instantiated with webknossos-store")


  requestFromStoreImpl : (batch, token) ->

    requestData = new MultipartData()

    for bucket in batch

      requestData.addPart(
        "X-Bucket" : JSON.stringify(bucket)
      )

    return requestData.dataPromise().then((data) =>
      Request.sendArraybufferReceiveArraybuffer(
          "#{@dataStoreInfo.url}/data/datasets/#{@dataSetName}/layers/#{@name}/data?token=#{token}",
          {
            data : data
            headers :
              "Content-Type" : "multipart/mixed; boundary=#{requestData.boundary}"
            timeout : @REQUEST_TIMEOUT
            compress : true
            doNotCatch : true
          }
      )
    ).then( (responseBuffer) ->
      return new Uint8Array(responseBuffer)
    )


  sendToStoreImpl : (batch, getBucketData, token) ->

    transmitData = new MultipartData()

    for bucket in batch

      transmitData.addPart(
          {"X-Bucket": JSON.stringify(bucket)},
          getBucketData(BucketBuilder.bucketToZoomedAddress(bucket)))

    return transmitData.dataPromise().then((data) =>
      return Request.sendArraybufferReceiveArraybuffer(
        "#{@dataStoreInfo.url}/data/datasets/#{@dataSetName}/layers/#{@name}/data?token=#{token}", {
          method : "PUT"
          data : data
          headers :
            "Content-Type" : "multipart/mixed; boundary=#{transmitData.boundary}"
          timeout : @REQUEST_TIMEOUT
          compress : true
          doNotCatch : true
        }
      )
    )


module.exports = WkLayer
