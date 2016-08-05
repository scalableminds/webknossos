Layer         = require("./layer")
Request       = require("../../../../libs/request")
MultipartData = require("../../../../libs/multipart_data")


class WkLayer extends Layer


  constructor : ->

    super(arguments...)

    unless @dataStoreInfo.typ == "webknossos-store"
      throw new Error("WkLayer should only be instantiated with webknossos-store")


  requestImpl : (batch, token) ->

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


module.exports = WkLayer
