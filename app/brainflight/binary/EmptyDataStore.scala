package brainflight.binary

import play.api.libs.concurrent.Promise
import scala.collection.mutable.ArrayBuffer
import brainflight.tools.Math._
import akka.agent.Agent
import models.binary.DataSet
import models.binary.DataLayer
import brainflight.tools.geometry.Point3D

class EmptyDataStore(cacheAgent: Agent[Map[DataBlockInformation, Data]])
    extends CachedDataStore(cacheAgent) {
  val nullBlock = new Array[Byte](elementsPerFile)

  def loadBlock(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, block: Point3D): Promise[DataBlock] = {
    Promise.pure {
      val blockInfo = DataBlockInformation(dataSet.id, dataLayer, resolution, block)
      DataBlock(blockInfo, Data(nullBlock))
    }
  }
}