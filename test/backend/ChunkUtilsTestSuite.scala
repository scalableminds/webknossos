package backend

import com.scalableminds.webknossos.datastore.datareaders.ChunkUtils
import org.scalatest.wordspec.AsyncWordSpec

class ChunkUtilsTestSuite extends AsyncWordSpec {

  "computeChunkIndices" when {
    // A t-batched bucket read (see DatasetArray.constructOffsetAndShapeArrays) deliberately
    // asks for a full 32-wide batch even when the axis ends earlier, because the wire format
    // is fixed-size. That is only safe because the chunk indices are clamped to the array
    // shape here, leaving readAsFortranOrder's target buffer zeroed past the end instead of
    // requesting (or failing on) chunks that don't exist.
    "the selection extends past the array shape" should {
      "not return chunk indices beyond the array's last chunk" in {
        val arrayShape = Array(50L, 32L, 32L) // e.g. t=50, y, x
        val chunkShape = Array(1, 32, 32) // one chunk per t
        val indices = ChunkUtils.computeChunkIndices(
          Some(arrayShape),
          chunkShape,
          selectedShape = Array(32, 32, 32), // t=32..63, i.e. 14 values past the end
          selectedOffset = Array(32L, 0L, 0L)
        )
        assert(indices.forall(_(0) <= 49))
        assert(indices.map(_(0)) == (32L to 49L))
      }

      "clamp a selection that starts past the end to the last chunk" in {
        val indices = ChunkUtils.computeChunkIndices(
          Some(Array(50L, 32L, 32L)),
          Array(1, 32, 32),
          selectedShape = Array(32, 32, 32),
          selectedOffset = Array(64L, 0L, 0L)
        )
        assert(indices.map(_(0)) == Seq(49L))
      }
    }

    "the selection fits within the array shape" should {
      "return every covered chunk" in {
        val indices = ChunkUtils.computeChunkIndices(
          Some(Array(64L, 32L, 32L)),
          Array(1, 32, 32),
          selectedShape = Array(32, 32, 32),
          selectedOffset = Array(32L, 0L, 0L)
        )
        assert(indices.map(_(0)) == (32L to 63L))
      }
    }
  }
}
