package models.dataset

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import utils.WkConf

import java.nio.{ByteBuffer, ByteOrder}
import javax.inject.Inject

/*
 * The interaction a SAM request carries. Bounding box and point prompts drive the model's
 * *tracker*: one prompted object, and the response is a binary 0/1 mask. Exemplar boxes drive
 * its *detector* ("find every instance that looks like these") and the response is a label map
 * with one id per detected instance instead. See the sam-serve repo's docs/protocol.md.
 *
 * Note on coordinate order: the server reads each coordinate pair as (y, x) and reverses it,
 * so the values written here end up transposed by the time they reach the model. That is
 * pre-existing behaviour which matches what is deployed, so all three prompt types write their
 * coordinates in the same order to keep the quirk uniform. Do not "fix" it on one side alone.
 */
sealed trait SAMPrompt {
  // Length of the interaction section on the wire, including the leading interaction type byte.
  def encodedLengthInBytes: Int

  def writeTo(buffer: ByteBuffer): Unit
}

case class SAMBoxPrompt(topLeftX: Int, topLeftY: Int, bottomRightX: Int, bottomRightY: Int) extends SAMPrompt {
  override def encodedLengthInBytes: Int = 1 + 4 * 4

  override def writeTo(buffer: ByteBuffer): Unit = {
    buffer.put(0.toByte)
    buffer.putInt(topLeftX)
    buffer.putInt(topLeftY)
    buffer.putInt(bottomRightX)
    buffer.putInt(bottomRightY)
  }
}

case class SAMPointPrompt(pointX: Int, pointY: Int) extends SAMPrompt {
  override def encodedLengthInBytes: Int = 1 + 2 * 4

  override def writeTo(buffer: ByteBuffer): Unit = {
    buffer.put(1.toByte)
    buffer.putInt(pointX)
    buffer.putInt(pointY)
  }
}

case class SAMExemplarBox(topLeftX: Int, topLeftY: Int, bottomRightX: Int, bottomRightY: Int, label: Int)

case class SAMExemplarPrompt(boxes: Seq[SAMExemplarBox]) extends SAMPrompt {
  override def encodedLengthInBytes: Int = 1 + 4 + SAMExemplarPrompt.bytesPerBox * boxes.length

  override def writeTo(buffer: ByteBuffer): Unit = {
    buffer.put(2.toByte)
    buffer.putInt(boxes.length)
    // Count-prefixed rather than interleaved: all boxes, then all labels. That lets the server
    // read each array with a single length-prefixed slice and no stride arithmetic. It also means
    // shape and data follow at an offset that depends on the box count, unlike the two fixed-size
    // interactions above.
    boxes.foreach { box =>
      buffer.putInt(box.topLeftX)
      buffer.putInt(box.topLeftY)
      buffer.putInt(box.bottomRightX)
      buffer.putInt(box.bottomRightY)
    }
    boxes.foreach(box => buffer.putInt(box.label))
  }
}

object SAMExemplarPrompt {
  // Four int32 coordinates plus one int32 label.
  val bytesPerBox: Int = 4 * 4 + 4

  // SAM 3.1 is built with max_num_objects=16 and silently drops detections beyond that, so there
  // is no point in accepting more exemplars than it can ever answer with.
  val maxBoxCount: Int = 16
}

object WKRemoteSegmentAnythingClient {

  /*
   * Build the binary request body: an 11-byte header, the interaction, the data shape and the
   * voxels. Kept separate from the request itself so that the wire format can be unit-tested
   * without an RPC.
   */
  def encodeRequest(
      imageData: Array[Byte],
      elementClass: ElementClass.Value,
      prompt: SAMPrompt,
      dataShape: Vec3Int, // two of the axes will be at most 1024, the other is the "depth". Axis order varies depending on viewport
      intensityMin: Option[Float],
      intensityMax: Option[Float]
  ): Array[Byte] = {
    val metadataLengthInBytes = 1 + 1 + 4 + 4 + prompt.encodedLengthInBytes + 4 + 4 + 4
    val buffer = ByteBuffer.allocate(metadataLengthInBytes + imageData.length).order(ByteOrder.LITTLE_ENDIAN)
    buffer.put(ElementClass.encodeAsByte(elementClass))
    buffer.put(if (intensityMin.isDefined && intensityMax.isDefined) 1.toByte else 0.toByte)
    buffer.putFloat(intensityMin.getOrElse(0.0f))
    buffer.putFloat(intensityMax.getOrElse(0.0f))
    prompt.writeTo(buffer)
    buffer.putInt(dataShape.x)
    buffer.putInt(dataShape.y)
    buffer.putInt(dataShape.z)
    val imageWithMetadata = buffer.array()
    System.arraycopy(imageData, 0, imageWithMetadata, metadataLengthInBytes, imageData.length)
    imageWithMetadata
  }
}

class WKRemoteSegmentAnythingClient @Inject() (rpc: RPC, conf: WkConf) {

  def getMask(
      imageData: Array[Byte],
      elementClass: ElementClass.Value,
      prompt: SAMPrompt,
      dataShape: Vec3Int,
      intensityMin: Option[Float],
      intensityMax: Option[Float]
  ): Fox[Array[Byte]] = {
    val body = WKRemoteSegmentAnythingClient.encodeRequest(
      imageData,
      elementClass,
      prompt,
      dataShape,
      intensityMin,
      intensityMax
    )
    rpc(s"${conf.SegmentAnything.uri}/predict")
      .withBasicAuthOpt(
        if (conf.SegmentAnything.user.isEmpty) None else Some(conf.SegmentAnything.user),
        Some(conf.SegmentAnything.password)
      )
      // Without this, Play WS' 120s default applies, which is shorter than the SAM server's own
      // timeout. Exemplar prompts run the full detector on every slice and are markedly slower
      // than an interactive prompt on the same volume.
      .withRequestTimeout(conf.SegmentAnything.requestTimeout)
      .addHttpHeader("Content-Type", "application/octet-stream")
      .postBytesWithBytesResponse(body)
  }
}
