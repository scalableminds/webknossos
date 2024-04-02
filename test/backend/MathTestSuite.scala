package backend

import com.scalableminds.util.tools.Math.ceilDiv
import org.scalatestplus.play.PlaySpec

class MathTestSuite extends PlaySpec {
  "Math" should {
    "ceilDiv correctly" in {
      assert(ceilDiv(5, 2) == 3)
      assert(ceilDiv(-5, 2) == -3)
      assert(ceilDiv(5, -2) == -3)
      assert(ceilDiv(-5, -2) == 3)
      assert(ceilDiv(4, 2) == 2)

      assert(ceilDiv(5L, 2L) == 3L)
      assert(ceilDiv(4L, 2L) == 2L)
    }
  }
}
