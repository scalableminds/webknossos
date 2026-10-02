package backend

import com.scalableminds.webknossos.datastore.datareaders.{Axis, FullAxisOrder}
import org.scalatest.wordspec.AsyncWordSpec

class AxisOrderPermutationTestSuite extends AsyncWordSpec {

  private def permute(permutation: Array[Int], str: String): String =
    permutation.map(i => str(i)).mkString("")

  private def orderFromStringChars(str: String) = FullAxisOrder(str.map(char => Axis(name = char.toString)))

  private def permuteAxisOrderPhysicalCtoWkC(str: String) = {
    val axisOrder = orderFromStringChars(str)
    permute(axisOrder.physicalToWkPermutation, axisOrder.toString)
  }

  private def permuteAxisOrderPhysicalFtoWkF(str: String) = {
    val axisOrder = orderFromStringChars(str)
    val axisOrderFStr = axisOrder.toString.reverse
    permute(axisOrder.physicalFToWkFPermutation, axisOrderFStr)
  }

  private def permuteAxisOrderPhysicalCtoWkF(str: String) = {
    val axisOrder = orderFromStringChars(str)
    permute(axisOrder.physicalCToWkFPermutation, axisOrder.toString)
  }

  "AxisOrderPermutation" should {
    "correctly permute from C (physical) to C (wk)" in {
      assert(permuteAxisOrderPhysicalCtoWkC("xyz") == "xyz")
      assert(permuteAxisOrderPhysicalCtoWkC("cxyz") == "cxyz")
      assert(permuteAxisOrderPhysicalCtoWkC("xycz") == "cxyz")
      assert(permuteAxisOrderPhysicalCtoWkC("xasdfczy") == "asdfcxyz")
    }

    "correctly permute from F (physical) to F (wk)" in {
      assert(permuteAxisOrderPhysicalFtoWkF("xyz") == "zyx")
      assert(permuteAxisOrderPhysicalFtoWkF("cxyz") == "zyxc")
      assert(permuteAxisOrderPhysicalFtoWkF("xycz") == "zyxc")
      assert(permuteAxisOrderPhysicalFtoWkF("xasdfczy") == "zyxcfdsa")
    }

    "correctly permute from C (physical) to F (wk)" in {
      assert(permuteAxisOrderPhysicalCtoWkF("xyz") == "zyx")
      assert(permuteAxisOrderPhysicalCtoWkF("cxyz") == "zyxc")
      assert(permuteAxisOrderPhysicalCtoWkF("xycz") == "zyxc")
      assert(permuteAxisOrderPhysicalCtoWkF("xasdfczy") == "zyxcfdsa")
      assert(permuteAxisOrderPhysicalCtoWkF("tasxdfczy") == "zyxcfdsat")
    }
  }

}
