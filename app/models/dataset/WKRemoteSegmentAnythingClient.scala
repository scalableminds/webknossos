package models.dataset

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import utils.WkConf

import java.nio.{ByteBuffer, ByteOrder}
import javax.inject.Inject

class WKRemoteSegmentAnythingClient @Inject()(rpc: RPC, conf: WkConf) {

  def getEmbedding(imageData: Array[Byte],
                   elementClass: ElementClass.Value,
                   intensityMin: Option[Float],
                   intensityMax: Option[Float]): Fox[Array[Byte]] = {
    val metadataLengthInBytes = 1 + 1 + 4 + 4
    val buffer = ByteBuffer.allocate(metadataLengthInBytes + imageData.length)
    buffer.put(ElementClass.encodeAsByte(elementClass))
    buffer.put(if (intensityMin.isDefined && intensityMax.isDefined) 1.toByte else 0.toByte)
    buffer.order(ByteOrder.LITTLE_ENDIAN).putFloat(intensityMin.getOrElse(0.0f))
    buffer.order(ByteOrder.LITTLE_ENDIAN).putFloat(intensityMax.getOrElse(0.0f))
    val imageWithMetadata = buffer.array()
    System.arraycopy(imageData, 0, imageWithMetadata, metadataLengthInBytes, imageData.length)
    rpc(s"${conf.SegmentAnything.uri}/predictions/sam_vit_l")
      .addQueryString("elementClass" -> elementClass.toString)
      .withBasicAuthOpt(if (conf.SegmentAnything.user.isEmpty) None else Some(conf.SegmentAnything.user),
                        Some(conf.SegmentAnything.password))
      .postBytesWithBytesResponse(imageWithMetadata)
  }

  def getMask(imageData: Array[Byte],
              elementClass: ElementClass.Value,
              boundingBox: BoundingBox,
              intensityMin: Option[Float],
              intensityMax: Option[Float]): Fox[Array[Byte]] = {
    val metadataLengthInBytes = 1 + 1 + 4 + 4
    val buffer = ByteBuffer.allocate(metadataLengthInBytes + imageData.length)
    buffer.put(ElementClass.encodeAsByte(elementClass))
    buffer.put(if (intensityMin.isDefined && intensityMax.isDefined) 1.toByte else 0.toByte)
    buffer.order(ByteOrder.LITTLE_ENDIAN).putFloat(intensityMin.getOrElse(0.0f))
    buffer.order(ByteOrder.LITTLE_ENDIAN).putFloat(intensityMax.getOrElse(0.0f))
    val imageWithMetadata = buffer.array()
    System.arraycopy(imageData, 0, imageWithMetadata, metadataLengthInBytes, imageData.length)
    rpc(s"${conf.SegmentAnything.uri}/predictions/sam_vit_l")
      .addQueryString("elementClass" -> elementClass.toString)
      .withBasicAuthOpt(if (conf.SegmentAnything.user.isEmpty) None else Some(conf.SegmentAnything.user),
                        Some(conf.SegmentAnything.password))
      .postBytesWithBytesResponse(imageWithMetadata)
  }
}
