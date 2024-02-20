package backend

import org.scalatestplus.play.PlaySpec
import com.scalableminds.util.tools.ByteUtils

class ByteUtilsTestSuite extends PlaySpec {

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
