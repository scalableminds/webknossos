package backend

import com.scalableminds.webknossos.datastore.datareaders.{Axis, FullAxisOrder}
import org.scalatestplus.play.PlaySpec

class AxisOrderPermutationTestSuite extends PlaySpec {

  private def permute(permutation: Array[Int], str: String): String =
    permutation.map(i => str(i)).mkString("")

  def orderFromStringChars(str: String) = FullAxisOrder(str.map(char => Axis(name = char.toString)))

  private def permuteAxisOrderArrayCtoWkC(str: String) = {
    val axisOrder = orderFromStringChars(str)
    permute(axisOrder.arrayToWkPermutation, axisOrder.toString)
  }

  private def permuteAxisOrderArrayFtoWkF(str: String) = {
    val axisOrder = orderFromStringChars(str)
    val axisOrderFStr = axisOrder.toString.reverse
    permute(axisOrder.arrayFToWkFPermutation, axisOrderFStr)
  }

  private def permuteAxisOrderArrayCtoWkF(str: String) = {
    val axisOrder = orderFromStringChars(str)
    permute(axisOrder.arrayCToWkFPermutation, axisOrder.toString)
  }

  "AxisOrderPermutation" should {
    "correctly permute from C (array) to C (wk)" in {
      assert(permuteAxisOrderArrayCtoWkC("xyz") == "xyz")
      assert(permuteAxisOrderArrayCtoWkC("cxyz") == "cxyz")
      assert(permuteAxisOrderArrayCtoWkC("xycz") == "cxyz")
      assert(permuteAxisOrderArrayCtoWkC("xasdfczy") == "asdfcxyz")
    }

    "correctly permute from F (array) to F (wk)" in {
      assert(permuteAxisOrderArrayFtoWkF("xyz") == "zyx")
      assert(permuteAxisOrderArrayFtoWkF("cxyz") == "zyxc")
      assert(permuteAxisOrderArrayFtoWkF("xycz") == "zyxc")
      assert(permuteAxisOrderArrayFtoWkF("xasdfczy") == "zyxcfdsa")
    }

    "correctly permute from C (array) to F (wk)" in {
      assert(permuteAxisOrderArrayCtoWkF("xyz") == "zyx")
      assert(permuteAxisOrderArrayCtoWkF("cxyz") == "zyxc")
      assert(permuteAxisOrderArrayCtoWkF("xycz") == "zyxc")
      assert(permuteAxisOrderArrayCtoWkF("xasdfczy") == "zyxcfdsa")
      assert(permuteAxisOrderArrayCtoWkF("tasxdfczy") == "zyxcfdsat")
    }
  }

}
