package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.ElementClass
import models.dataset.{
  SAMBoxPrompt,
  SAMExemplarBox,
  SAMExemplarPrompt,
  SAMPointPrompt,
  SAMPrompt,
  WKRemoteSegmentAnythingClient
}
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.{ByteBuffer, ByteOrder}

/*
 * Pins the binary wire format spoken with the SAM server. Mirrors the round-trip tests in the
 * sam-serve repo (tests/test_protocol.py) so that the two sides cannot drift apart silently.
 *
 * The header is 11 bytes: dtype(1) has_range(1) min_range(f32) max_range(f32) interaction_type(1).
 */
class SegmentAnythingProtocolTestSuite extends AsyncWordSpec {

  private val headerLength = 11
  private val shapeLength = 12

  private def encode(prompt: SAMPrompt, imageData: Array[Byte], shape: Vec3Int): Array[Byte] =
    WKRemoteSegmentAnythingClient.encodeRequest(
      imageData,
      ElementClass.uint8,
      prompt,
      shape,
      None,
      None
    )

  private def intAt(payload: Array[Byte], offset: Int): Int =
    ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN).getInt(offset)

  private def intsAt(payload: Array[Byte], offset: Int, count: Int): Seq[Int] =
    (0 until count).map(i => intAt(payload, offset + 4 * i))

  private def sampleImage(length: Int): Array[Byte] =
    Array.tabulate(length)(i => (i % 251).toByte)

  "The SAM request header" should {
    "stay packed at 11 bytes, with the interaction type as its last byte" in {
      val boxPayload = encode(SAMBoxPrompt(1, 2, 3, 4), sampleImage(8), Vec3Int(2, 2, 2))
      val pointPayload = encode(SAMPointPrompt(1, 2), sampleImage(8), Vec3Int(2, 2, 2))
      val exemplarPayload =
        encode(SAMExemplarPrompt(Seq(SAMExemplarBox(1, 2, 3, 4, 1))), sampleImage(8), Vec3Int(2, 2, 2))
      assert(boxPayload(10) == 0.toByte)
      assert(pointPayload(10) == 1.toByte)
      assert(exemplarPayload(10) == 2.toByte)
    }
  }

  "A bounding box prompt" should {
    // Guards the offsets the two fixed-size interactions have always used. Adding the
    // variable-length exemplar interaction must not move them.
    "keep shape at offset 27 and voxels at offset 39" in {
      val image = sampleImage(24)
      val payload = encode(SAMBoxPrompt(10, 20, 30, 40), image, Vec3Int(2, 3, 4))
      assert(intsAt(payload, headerLength, 4) == Seq(10, 20, 30, 40))
      assert(intsAt(payload, 27, 3) == Seq(2, 3, 4))
      assert(payload.length == 27 + shapeLength + image.length)
      assert(payload.drop(39).toSeq == image.toSeq)
    }
  }

  "A point prompt" should {
    "keep shape at offset 19 and voxels at offset 31" in {
      val image = sampleImage(24)
      val payload = encode(SAMPointPrompt(10, 20), image, Vec3Int(2, 3, 4))
      assert(intsAt(payload, headerLength, 2) == Seq(10, 20))
      assert(intsAt(payload, 19, 3) == Seq(2, 3, 4))
      assert(payload.length == 19 + shapeLength + image.length)
      assert(payload.drop(31).toSeq == image.toSeq)
    }
  }

  "An exemplar prompt" should {
    // Mirrors test_exemplar_boxes_round_trip_with_labels: the layout is asserted directly rather
    // than by decoding with our own encoder.
    "write a count, then all boxes, then all labels" in {
      val boxes = Seq(SAMExemplarBox(10, 20, 30, 40, 1), SAMExemplarBox(50, 60, 70, 80, 0))
      val payload = encode(SAMExemplarPrompt(boxes), sampleImage(8), Vec3Int(2, 2, 2))
      assert(intAt(payload, headerLength) == 2)
      assert(intsAt(payload, 15, 8) == Seq(10, 20, 30, 40, 50, 60, 70, 80))
      assert(intsAt(payload, 15 + 32, 2) == Seq(1, 0))
    }

    "use the same coordinate field order as a bounding box prompt" in {
      // The server reads each pair as (y, x) and reverses it, which transposes the coordinates.
      // That quirk is pre-existing and matches production, so it has to apply identically to all
      // prompt types -- which it only does if both write topLeftX before topLeftY.
      val boxPayload = encode(SAMBoxPrompt(10, 20, 30, 40), sampleImage(8), Vec3Int(2, 2, 2))
      val exemplarPayload =
        encode(SAMExemplarPrompt(Seq(SAMExemplarBox(10, 20, 30, 40, 1))), sampleImage(8), Vec3Int(2, 2, 2))
      assert(intsAt(boxPayload, headerLength, 4) == intsAt(exemplarPayload, headerLength + 4, 4))
    }

    // Mirrors test_exemplar_prompt_does_not_disturb_the_volume. The count-prefixed field is the
    // one thing that can plausibly shift the voxel offset.
    "not disturb the voxel payload as the box count varies" in {
      val image = sampleImage(24)
      val shape = Vec3Int(2, 3, 4)
      Seq(1, 3, 7, SAMExemplarPrompt.maxBoxCount).foreach { count =>
        val boxes = Seq.fill(count)(SAMExemplarBox(1, 2, 3, 4, 1))
        val payload = encode(SAMExemplarPrompt(boxes), image, shape)
        val shapeOffset = 15 + 20 * count
        val dataOffset = shapeOffset + shapeLength
        assert(intAt(payload, headerLength) == count)
        assert(intsAt(payload, shapeOffset, 3) == Seq(2, 3, 4))
        assert(payload.length == dataOffset + image.length)
        assert(payload.drop(dataOffset).toSeq == image.toSeq)
      }
      succeed
    }

    "report an encoded length that matches what it writes" in {
      Seq(1, 2, 5, 16).foreach { count =>
        val prompt = SAMExemplarPrompt(Seq.fill(count)(SAMExemplarBox(1, 2, 3, 4, 1)))
        assert(prompt.encodedLengthInBytes == 1 + 4 + 20 * count)
      }
      succeed
    }
  }

  "The intensity range" should {
    "set has_range only when both bounds are given" in {
      val withRange = WKRemoteSegmentAnythingClient.encodeRequest(
        sampleImage(8),
        ElementClass.uint8,
        SAMExemplarPrompt(Seq(SAMExemplarBox(1, 2, 3, 4, 1))),
        Vec3Int(2, 2, 2),
        Some(0.25f),
        Some(0.75f)
      )
      val withoutRange = encode(SAMExemplarPrompt(Seq(SAMExemplarBox(1, 2, 3, 4, 1))), sampleImage(8), Vec3Int(2, 2, 2))
      assert(withRange(1) == 1.toByte)
      assert(withoutRange(1) == 0.toByte)
      val buffer = ByteBuffer.wrap(withRange).order(ByteOrder.LITTLE_ENDIAN)
      assert(buffer.getFloat(2) == 0.25f)
      assert(buffer.getFloat(6) == 0.75f)
    }
  }
}
