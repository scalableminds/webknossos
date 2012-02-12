package brainflight.tools

import brainflight.tools.Math._
import org.specs2.mutable.Specification

class MathTest extends Specification {
  "Math library" should {
    "square a value" in {
      square(5) must be equalTo 25
      square(2.5) must be equalTo 6.25
    }
  }
}