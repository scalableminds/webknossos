package models.binary

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import utils.WkConf

import java.nio.ByteBuffer
import javax.inject.Inject

class WKRemoteSegmentAnythingClient @Inject()(rpc: RPC, conf: WkConf) {
  def getEmbedding(imageData: Array[Byte],
                   elementClass: ElementClass.Value,
                   intensityMin: Option[Double],
                   intensityMax: Option[Double]): Fox[Array[Byte]] = {
    val metadataLengthInBytes = 1 + 1 + 8 + 8
    val buffer = ByteBuffer.allocate(metadataLengthInBytes + imageData.length)
    buffer.put(ElementClass.encodeAsByte(elementClass))
    buffer.put(if (intensityMin.isDefined && intensityMax.isDefined) 1.toByte else 0.toByte)
    buffer.putDouble(intensityMin.getOrElse(0.0))
    buffer.putDouble(intensityMax.getOrElse(0.0))
    val array = buffer.array()
    System.arraycopy(imageData, 0, array, metadataLengthInBytes, imageData.length)
    rpc(s"${conf.SegmentAnything.uri}/predictions/sam_vit_l")
      .addQueryString("elementClass" -> elementClass.toString)
      .addQueryStringOptional("intensityMinFloat64Base64", intensityMin.map(_.toString))
      .addQueryStringOptional("intensityMinFloat64Base64", intensityMax.map(_.toString))
      .postBytesWithBytesResponse(imageData)
  }

}
