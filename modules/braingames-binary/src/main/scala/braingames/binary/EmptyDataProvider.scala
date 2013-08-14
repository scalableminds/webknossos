package braingames.binary

import akka.agent.Agent
import akka.actor.ActorSystem
import braingames.binary.models.DataLayer
import braingames.binary.models.DataSet

trait EmptyDataProvider {
  implicit val sys: ActorSystem

  lazy val nullFiles = Agent[Map[(Int, Int), Array[Byte]]](Map.empty)

  def loadNullBlock(dataSet: DataSet, dataLayer: DataLayer): Array[Byte] = {
    nullFile(dataSet.blockSize, dataLayer.bytesPerElement)
  }

  def createNullArray(blockSize: Int, bytesPerElement: Int) =
    new Array[Byte](blockSize * bytesPerElement)

  def nullFile(blockSize: Int, bytesPerElement: Int) =
    nullFiles().get((blockSize, bytesPerElement)).getOrElse {
      val a = createNullArray(blockSize, bytesPerElement)
      nullFiles.send(_ + ((blockSize -> bytesPerElement) -> a))
      a
    }
}