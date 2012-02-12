import brainflight.binary.{DataModel,DataStore,ModelStore}
import org.specs2.mutable.Specification
import java.io.FileNotFoundException
import brainflight.tools.geometry.NGonalFrustum
import play.api.test._
import play.api.test.Helpers._

class ModelStoreTest extends Specification {
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
}
