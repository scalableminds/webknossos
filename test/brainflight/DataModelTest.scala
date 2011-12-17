import brainflight.binary._
import org.specs2.mutable.Specification
import java.io.FileNotFoundException
import brainflight.tools.geometry.NGonalFrustum
import play.api.test._
import play.api.test.MockApplication._

//class DataModelTest extends JUnit3(DataModelTestSpecs)
//object DataModelTestSpecsRunner extends ConsoleRunner(DataModelTestSpecs)

class DataStoreTest extends Specification {
  sequential
  "DataStore" should {
    "load Data" in {
      withApplication(Nil,Map()) {
        try {
          // if this failes the data has changed
          DataStore.load((0, 0, 0)) must be equalTo (0.toByte)
        } catch {
          case e: FileNotFoundException =>
            ko("Data not found: Put binary data in e.q. binarydata/x0000/y0000/z0000/100527_k0563_mag1_x0000_y0000_z0000.raw")
        }
      }
    }
  }
}

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
      TestModel.rotateAndMove((1, 2, 3), (0, 1, 0)) must be equalTo IndexedSeq(
        (0, 2, 2), (0, 2, 3), (0, 2, 4), (1, 2, 2), (1, 2, 3), (1, 2, 4), (2, 2, 2), (2, 2, 3), (2, 2, 4), (0, 3, 2), (0, 3, 3), (0, 3, 4), (1, 3, 2), (1, 3, 3), (1, 3, 4), (2, 3, 2), (2, 3, 3), (2, 3, 4), (0, 4, 2), (0, 4, 3), (0, 4, 4), (1, 4, 2), (1, 4, 3), (1, 4, 4), (2, 4, 2), (2, 4, 3), (2, 4, 4)
      )
    }
    "be able to rotate Model" in {
      TestModel.rotateAndMove((0, 0, 0), (1, 2, 3)) must be equalTo IndexedSeq(
        (-1, 1, 0), (-1, 0, 0), (-1, -1, 1), (0, 1, -1), (0, 0, 0), (0, -1, 1), (1, 1, -1), (1, 0, 0), (1, -1, 0), (-1, 2, 0), (-1, 1, 1), (-1, 0, 2), (0, 1, 0), (0, 1, 1), (0, 0, 1), (1, 1, 0), (1, 0, 1), (1, -1, 1), (0, 2, 1), (0, 1, 2), (-1, 1, 2), (1, 2, 1), (1, 1, 2), (0, 0, 2), (2, 2, 1), (1, 1, 1), (1, 0, 2)
      )
    }
    "should rotate independent of the rotating vectors size" in {
      TestModel.rotateAndMove((0, 0, 0), (1, 2, 3)) must be equalTo TestModel.rotateAndMove((0, 0, 0), (2, 4, 6))
    }
  }
}
