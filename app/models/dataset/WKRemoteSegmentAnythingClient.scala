package models.dataset

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import controllers.SAMInteractionType
import controllers.SAMInteractionType.SAMInteractionType
import utils.WkConf

import java.nio.{ByteBuffer, ByteOrder}
import javax.inject.Inject

class WKRemoteSegmentAnythingClient @Inject()(rpc: RPC, conf: WkConf) {

  def getMask(
      imageData: Array[Byte],
      elementClass: ElementClass.Value,
      samInteractionType: SAMInteractionType,
      selectionTopLeftXOpt: Option[Int],
      selectionTopLeftYOpt: Option[Int],
      selectionBottomRightXOpt: Option[Int],
      selectionBottomRightYOpt: Option[Int],
      pointXOpt: Option[Int],
      pointYOpt: Option[Int],
      dataShape: Vec3Int, // two of the axes will be at most 1024, the other is the "depth". Axis order varies depending on viewport
      intensityMin: Option[Float],
      intensityMax: Option[Float]): Fox[Array[Byte]] = {
    val interactionInputLengthInBytes = 1 + (
      if (samInteractionType == SAMInteractionType.BOUNDING_BOX) 4 + 4 + 4 + 4 else 4 + 4
    )
    val metadataLengthInBytes = 1 + 1 + 4 + 4 + interactionInputLengthInBytes + 4 + 4 + 4
    val buffer = ByteBuffer.allocate(metadataLengthInBytes + imageData.length).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put(ElementClass.encodeAsByte(elementClass))
    buffer.put(if (intensityMin.isDefined && intensityMax.isDefined) 1.toByte else 0.toByte)
    buffer.putFloat(intensityMin.getOrElse(0.0f))
    buffer.putFloat(intensityMax.getOrElse(0.0f))
    if (samInteractionType == SAMInteractionType.BOUNDING_BOX) {
      buffer.put(0.toByte) // Set bounding box interaction
      buffer.putInt(selectionTopLeftXOpt.getOrElse(0))
      buffer.putInt(selectionTopLeftYOpt.getOrElse(0))
      buffer.putInt(selectionBottomRightXOpt.getOrElse(0))
      buffer.putInt(selectionBottomRightYOpt.getOrElse(0))
    } else { // Else only point interaction is possible
      buffer.put(1.toByte) // Set point interaction
      buffer.putInt(pointXOpt.getOrElse(0))
      buffer.putInt(pointYOpt.getOrElse(0))
    }
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
