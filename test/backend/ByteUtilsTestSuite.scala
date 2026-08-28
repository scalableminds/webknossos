package backend

import com.scalableminds.util.tools.ByteUtils
import org.scalatest.wordspec.AsyncWordSpec

class ByteUtilsTestSuite extends AsyncWordSpec {

  class ByteUtilsTest extends ByteUtils

  "converting long to bytes" should {
    "work correctly" in {
      val long = 123456789L
      val byteUtil = new ByteUtilsTest
      val bytesInLittleEndian = byteUtil.longToBytes(long)

      assert(BigInt(bytesInLittleEndian.reverse) == long)
    }
  }

}
