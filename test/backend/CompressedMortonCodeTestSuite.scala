package backend

import com.scalableminds.webknossos.datastore.datareaders.precomputed.CompressedMortonCode
import org.scalatest.wordspec.AsyncWordSpec

class CompressedMortonCodeTestSuite extends AsyncWordSpec {

  "Compressed Morton Code" when {
    "Grid size = 10,10,10" should {
      val grid_size = Array(10, 10, 10)
      "encode 0,0,0" in {
        assert(CompressedMortonCode.encode(Array(0, 0, 0), grid_size) == 0)
      }
      "encode 1,2,3" in {
        assert(CompressedMortonCode.encode(Array(1, 2, 3), grid_size) == 53)
      }
      "encode 9,9,9" in {
        assert(CompressedMortonCode.encode(Array(9, 9, 9), grid_size) == 3591)
      }
      "encode 10,10,10" in {
        assert(CompressedMortonCode.encode(Array(10, 10, 10), grid_size) == 3640)
      }
    }
    "Grid size = 2048,2048,1024" should {
      val grid_size = Array(2048, 2048, 1024)
      "encode 0,0,0" in {
        assert(CompressedMortonCode.encode(Array(0, 0, 0), grid_size) == 0)
      }
      "encode 1,2,3" in {
        assert(CompressedMortonCode.encode(Array(1, 2, 3), grid_size) == 53)
      }
      "encode 1024, 512, 684" in {
        assert(CompressedMortonCode.encode(Array(1024, 512, 684), grid_size) == 1887570176)
      }
    }
  }
}
