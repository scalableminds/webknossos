package backend

import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import com.scalableminds.webknossos.datastore.models.datasource.AdditionalCoordinateDefinition
import org.scalatestplus.play.PlaySpec

class AdditionalCoordinateTestSuite extends PlaySpec with ProtoGeometryImplicits {

  private def definitionsEqual(a: AdditionalCoordinateDefinition, b: AdditionalCoordinateDefinition) =
    a.name == b.name && a.index == b.index && a.lowerBound == b.lowerBound && a.upperBound == b.upperBound

  "Additional coordinates" when {
    val definitionT = AdditionalCoordinateDefinition("t", Array(0, 25), 0)
    "converting to proto" should {
      "return correct value" in {
        val proto = AdditionalCoordinateDefinition.toProto(Some(Seq(definitionT)))
        assert(proto.size == 1)
        assert(proto.head.name == definitionT.name)
        assert(proto.head.index == definitionT.index)
        assert(arrayFromVec2IntProto(proto.head.bounds).sameElements(definitionT.bounds))
      }
      "be reversible" in {
        val proto = AdditionalCoordinateDefinition.toProto(Some(Seq(definitionT)))
        val deProtofied = AdditionalCoordinateDefinition.fromProto(proto)
        assert(definitionsEqual(deProtofied.head, definitionT))
      }
    }
    "merging" should {
      val definitionA = AdditionalCoordinateDefinition("a", Array(10, 30), 1)
      val definitionB = AdditionalCoordinateDefinition("b", Array(0, 100), 2)
      val definitionT2 = AdditionalCoordinateDefinition("t", Array(10, 40), 3)
      "give merge" in {
        val merged =
          AdditionalCoordinateDefinition
            .merge(Seq(Some(Seq(definitionA, definitionB)), Some(Seq(definitionT))))
            .get
            .sortBy(_.index)

        assert(
          definitionsEqual(merged(0), definitionT) &&
            definitionsEqual(merged(1), definitionA) &&
            definitionsEqual(merged(2), definitionB))
      }
      "merge bounds" in {
        val merged = AdditionalCoordinateDefinition.merge(Seq(Some(Seq(definitionT2)), Some(Seq(definitionT)))).get
        assert(merged.head.bounds.sameElements(Array(0, 40)))
      }
      "using assert same coordinates" should {
        "fail when coordinates are not the same" in {
          val merged = AdditionalCoordinateDefinition.mergeAndAssertSameAdditionalCoordinates(
            Seq(Some(Seq(definitionA)), Some(Seq(definitionT))))
          assert(merged.isEmpty)
        }
        "succeed when coordinates are the same" in {
          val merged = AdditionalCoordinateDefinition.mergeAndAssertSameAdditionalCoordinates(
            Seq(Some(Seq(definitionT)), Some(Seq(definitionT2))))
          assert(!merged.isEmpty)
          assert(merged.openOrThrowException("test").get.head.name == "t")
        }
      }

    }
  }
}
