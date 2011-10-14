package com.scalableminds.brainflight

import org.specs._
import net.liftweb._
import net.liftweb.util._
import binary.{FrustrumModel, CubeModel, ModelStore}

//class DataModelTest extends JUnit3(DataModelTestSpecs)
//object DataModelTestSpecsRunner extends ConsoleRunner(DataModelTestSpecs)

object DataModelTestSpecs extends Specification {

  "ModelStore" should {
    "contain one Element" in {
      ModelStore.register(CubeModel)
      ModelStore.models.size must be equalTo 1
    }
    "match Cube id" in {
      ModelStore(CubeModel.id) must be like{
        case Some(_) => true
      }
    }
  }
}
