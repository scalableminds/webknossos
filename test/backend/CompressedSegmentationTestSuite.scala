package backend

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.datareaders.precomputed.compressedsegmentation.CompressedSegmentation64
import org.scalatestplus.play.PlaySpec

import java.nio.{ByteBuffer, ByteOrder}

class CompressedSegmentationTestSuite extends PlaySpec {

  "Compressed segmentation" when {

    /*
    # The compressed test data was created with this python code:
    import compressed_segmentation as cseg
    import numpy as np

    input = np.array([[[5, 5, 4],
            [4, 1, 7],
            [5, 3, 5]],

           [[3, 8, 5],
            [9, 8, 4],
            [4, 9, 3]],

           [[6, 1, 9],
            [3, 7, 8],
            [8, 0, 9]]], dtype=np.uint64)

    compressed = cseg.compress(input)

    # Compressed output
    # 1, 0, 0, 0, 66, 0, 0, 4, 2, 0, 0, 0, 36, 5, 0, 0, 131, 2, 0, 0, 52, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 116, 1, 0, 0, 113, 6, 0, 0, 130, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 67, 8, 0, 0, 54, 7, 0, 0, 36, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0
     */

    val compressed = Array[Byte](1, 0, 0, 0, 66, 0, 0, 4, 2, 0, 0, 0, 36, 5, 0, 0, -125, 2, 0, 0, 52, 7, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 116, 1, 0, 0, 113, 6, 0, 0, -126, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 67, 8, 0, 0, 54, 7, 0, 0, 36, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0,
      0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0,
      0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0)

    "datatype uint64" should {

      "decompress compressed array" in {
        val decompressedBytes =
          CompressedSegmentation64.decompress(compressed, volumeSize = Array(3, 3, 3), blockSize = Vec3Int(8, 8, 8))
        val arr = new Array[Long](27)
        ByteBuffer.wrap(decompressedBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer().get(arr)
        assert(arr.sameElements(Array(5, 3, 6, 4, 9, 3, 5, 4, 8, 5, 8, 1, 1, 8, 7, 3, 9, 0, 4, 5, 9, 7, 4, 8, 5, 3, 9)))
      }
    }
  }
}
