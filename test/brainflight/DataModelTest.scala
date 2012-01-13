import brainflight.binary.{DataModel,DataStore,ModelStore}
import org.specs2.mutable.Specification
import java.io.FileNotFoundException
import brainflight.tools.geometry.NGonalFrustum
import play.api.test._
import play.api.test.Helpers._

class DataModelTestSpecs extends Specification {
  sequential
  object TestModel extends DataModel {
    val id = "testModel"
    val yLength = 2
    val polygons = new NGonalFrustum(4, yLength, yLength / 2, yLength / 2).polygons
  }

  "ModelStore" should {
    "contain one Element" in {
      ModelStore.models.clear()
      ModelStore.register(TestModel)
      ModelStore.models.size must be equalTo 1
    }
    "match Cube id" in {
      ModelStore.register(TestModel)
      ModelStore(TestModel.id) must beLike {
        case Some(_) => ok
        case _ => ko
      }
    }
  }

  "Abstract DataModel" should {
    "be able to move Model" in {
      TestModel.rotateAndMove((1, 2, 3), (0, 1, 0)).seq must be equalTo IndexedSeq(
        (0, 2, 2), (0, 2, 3), (0, 2, 4), (1, 2, 2), (1, 2, 3), (1, 2, 4), (2, 2, 2), (2, 2, 3), (2, 2, 4), (0, 3, 2), (0, 3, 3), (0, 3, 4), (1, 3, 2), (1, 3, 3), (1, 3, 4), (2, 3, 2), (2, 3, 3), (2, 3, 4), (0, 4, 2), (0, 4, 3), (0, 4, 4), (1, 4, 2), (1, 4, 3), (1, 4, 4), (2, 4, 2), (2, 4, 3), (2, 4, 4)
      )
    }
    "be able to rotate Model" in {
      TestModel.rotateAndMove((0, 0, 0), (1, 2, 3)).seq must be equalTo IndexedSeq(
        (-1, 1, 0), (-1, 0, 0), (-1, -1, 1), (0, 1, -1), (0, 0, 0), (0, -1, 1), (1, 1, -1), (1, 0, 0), (1, -1, 0), (-1, 2, 0), (-1, 1, 1), (-1, 0, 2), (0, 1, 0), (0, 1, 1), (0, 0, 1), (1, 1, 0), (1, 0, 1), (1, -1, 1), (0, 2, 1), (0, 1, 2), (-1, 1, 2), (1, 2, 1), (1, 1, 2), (0, 0, 2), (2, 2, 1), (1, 1, 1), (1, 0, 2)
      )
    }
    "should rotate independent of the rotating vectors size" in {
      TestModel.rotateAndMove((0, 0, 0), (1, 2, 3)) must be equalTo TestModel.rotateAndMove((0, 0, 0), (2, 4, 6))
    }
  }
}
