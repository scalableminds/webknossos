package brainflight.binary

import play.api.libs.concurrent.Promise
import scala.collection.mutable.ArrayBuffer
import brainflight.tools.Math._
import akka.agent.Agent
import models.binary.DataSet
import models.binary.DataLayer
import brainflight.tools.geometry.Point3D
import play.api.Logger

class EmptyDataStore(cacheAgent: Agent[Map[LoadBlock, Data]])
    extends CachedDataStore(cacheAgent) {
  val nullBlock = new Array[Byte](elementsPerFile)

  def loadBlock(blockInfo: LoadBlock): Promise[DataBlock] = {
    Promise.pure {
      DataBlock(blockInfo, Data(nullFile(blockInfo.dataLayer.bytesPerElement)))
    }
  }
}