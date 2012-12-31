package brainflight.binary

import play.api.libs.concurrent.Promise
import scala.collection.mutable.ArrayBuffer
import brainflight.tools.Math._
import akka.agent.Agent
import models.binary.DataSet
import models.binary.DataLayer
import brainflight.tools.geometry.Point3D
import play.api.Logger

class EmptyDataStore
    extends DataStore {
  val nullBlock = new Array[Byte](elementsPerFile)

  def load(blockInfo: LoadBlock): Promise[Array[Byte]] = {
    Promise.pure {
      nullFile(blockInfo.bytesPerElement)
    }
  }
}