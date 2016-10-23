Layer         = require("./layer")
BucketBuilder = require("./bucket_builder")
Request       = require("../../../../libs/request")
MultipartData = require("../../../../libs/multipart_data")
_             = require("lodash")


class WkLayer extends Layer


  constructor : ->

    super

    unless @dataStoreInfo.typ == "webknossos-store"
      throw new Error("WkLayer should only be instantiated with webknossos-store")

    @fourBit = false


  setFourBit : (newFourBit) ->

    # No op if this is not a color layer
    if @category == "color"
      @fourBit = newFourBit


  buildBuckets : (batch, options={}) ->

    options = _.extend(options, { fourBit : @fourBit })
    return super(batch, options)


  requestFromStoreImpl : (batch, token) ->

    wasFourBit = @fourBit
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
    ).then( (responseBuffer) =>
      result = new Uint8Array(responseBuffer)
      if wasFourBit
        result = @decodeFourBit(result)
      return result
    )


  decodeFourBit : (bufferArray) ->

    # Expand 4-bit data
    newColors = new Uint8Array(bufferArray.length << 1)

    index = 0
    while index < newColors.length
      value = bufferArray[index >> 1]
      newColors[index] = value & 0b11110000
      index++
      newColors[index] = value << 4
      index++

    return newColors


  sendToStoreImpl : (batch, getBucketData, token) ->

    transmitData = new MultipartData()

    for bucket in batch

      transmitData.addPart(
        {"X-Bucket" : JSON.stringify(bucket)},
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
