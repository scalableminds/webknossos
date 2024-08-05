package models.dataset

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import utils.WkConf

import java.nio.{ByteBuffer, ByteOrder}
import javax.inject.Inject

class WKRemoteSegmentAnythingClient @Inject()(rpc: RPC, conf: WkConf) {

  def getMask(
      imageData: Array[Byte],
      elementClass: ElementClass.Value,
      selectionTopLeftX: Int,
      selectionTopLeftY: Int,
      selectionBottomRightX: Int,
      selectionBottomRightY: Int,
      dataShape: Vec3Int, // two of the axes will be 1024, the other is the "depth". Axis order varies depending on viewport
      intensityMin: Option[Float],
      intensityMax: Option[Float]): Fox[Array[Byte]] = {
    val metadataLengthInBytes = 1 + 1 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4
    val buffer = ByteBuffer.allocate(metadataLengthInBytes + imageData.length).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put(ElementClass.encodeAsByte(elementClass))
    buffer.put(if (intensityMin.isDefined && intensityMax.isDefined) 1.toByte else 0.toByte)
    buffer.putFloat(intensityMin.getOrElse(0.0f))
    buffer.putFloat(intensityMax.getOrElse(0.0f))
    buffer.putInt(selectionTopLeftX)
    buffer.putInt(selectionTopLeftY)
    buffer.putInt(selectionBottomRightX)
    buffer.putInt(selectionBottomRightY)
    buffer.putInt(dataShape.x)
    buffer.putInt(dataShape.y)
    buffer.putInt(dataShape.z)
    val imageWithMetadata = buffer.array()
    System.arraycopy(imageData, 0, imageWithMetadata, metadataLengthInBytes, imageData.length)
    rpc(s"${conf.SegmentAnything.uri}/predictions/sam2_hiera_b")
      .withBasicAuthOpt(if (conf.SegmentAnything.user.isEmpty) None else Some(conf.SegmentAnything.user),
                        Some(conf.SegmentAnything.password))
      .postBytesWithBytesResponse(imageWithMetadata)
  }
}
