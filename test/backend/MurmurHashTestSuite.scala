package backend

import com.scalableminds.webknossos.datastore.datareaders.precomputed.MurmurHash3
import org.scalatest.wordspec.AsyncWordSpec

class MurmurHashTestSuite extends AsyncWordSpec {

  "Murmur hash" should {
    "return the correct hash" in {
      val keyString = "Hello World!"
      val keyBytes = keyString.getBytes
      val seed = 0
      val expectedHash = -1505357907696379773L
      val actualHash = MurmurHash3.hash64(keyBytes, seed)

      assert(actualHash == expectedHash)
    }
  }
}
