package backend

import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis
import org.scalatestplus.play.PlaySpec

class AdditionalCoordinateTestSuite extends PlaySpec with ProtoGeometryImplicits {

  private def definitionsEqual(a: AdditionalAxis, b: AdditionalAxis) =
    a.name == b.name && a.index == b.index && a.lowerBound == b.lowerBound && a.upperBound == b.upperBound

  "Additional coordinate axis" when {
    val axisT = AdditionalAxis("t", Array(0, 25), 0)
    "converting to proto" should {
      "return correct value" in {
        val proto = AdditionalAxis.toProto(Some(Seq(axisT)))
        assert(proto.size == 1)
        assert(proto.head.name == axisT.name)
        assert(proto.head.index == axisT.index)
        assert(arrayFromVec2IntProto(proto.head.bounds).sameElements(axisT.bounds))
      }
      "be reversible" in {
        val proto = AdditionalAxis.toProto(Some(Seq(axisT)))
        val deProtofied = AdditionalAxis.fromProtos(proto)
        assert(definitionsEqual(deProtofied.head, axisT))
      }
    }
    "merging" should {
      val axisA = AdditionalAxis("a", Array(10, 30), 1)
      val axisB = AdditionalAxis("b", Array(0, 100), 2)
      val axisT2 = AdditionalAxis("t", Array(10, 40), 3)
      "give merge" in {
        val merged =
          AdditionalAxis
            .merge(Seq(Some(Seq(axisA, axisB)), Some(Seq(axisT))))
            .get
            .sortBy(_.index)

        assert(
          definitionsEqual(merged(0), axisT) &&
            definitionsEqual(merged(1), axisA) &&
            definitionsEqual(merged(2), axisB))
      }
      "merge bounds" in {
        val merged = AdditionalAxis.merge(Seq(Some(Seq(axisT2)), Some(Seq(axisT)))).get
        assert(merged.head.bounds.sameElements(Array(0, 40)))
      }
      "using assert same coordinates" should {
        "fail when coordinates are not the same" in {
          val merged = AdditionalAxis.mergeAndAssertSameAdditionalAxes(
            Seq(Some(Seq(axisA)), Some(Seq(axisT))))
          assert(merged.isEmpty)
        }
        "succeed when coordinates are the same" in {
          val merged = AdditionalAxis.mergeAndAssertSameAdditionalAxes(
            Seq(Some(Seq(axisT)), Some(Seq(axisT2))))
          assert(!merged.isEmpty)
          assert(merged.openOrThrowException("test").get.head.name == "t")
        }
      }

    }
  }
}
