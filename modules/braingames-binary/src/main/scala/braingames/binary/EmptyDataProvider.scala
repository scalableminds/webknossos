package braingames.binary

import scala.concurrent.Future
import akka.agent.Agent
import akka.actor.ActorSystem
import braingames.binary.models.DataLayer
import braingames.binary.models.DataSet

trait EmptyDataProvider {
  implicit val sys: ActorSystem

  val nullFiles = Agent[Map[(Int, Int), Array[Byte]]](Map.empty)

  def loadNullBlock(dataSet: DataSet, dataLayer: DataLayer): Array[Byte] = {
    nullFile(dataSet.blockSize, dataLayer.bytesPerElement)
  }

  def createNullArray(blockSize: Int, bytesPerElement: Int) =
    new Array[Byte](blockSize * bytesPerElement)

  /*lazy val nullBlocks: Array[Array[Byte]] =
    (0 to MAX_BYTES_PER_ELEMENT).toArray.map { exp =>
      val bytesPerElement = math.pow(2, exp).toInt
      createNullArray(blockSize, bytesPerElement)
    }

  def nullBlock(bytesPerElement: Int) =
    nullBlocks(log2(bytesPerElement).toInt)*/

  /*lazy val nullFiles: Map[,Array[Byte]] =
    (1 to MAX_BYTES_PER_ELEMENT).toStream.map { bytesPerElement =>
      new Array[Byte](blockSize * bytesPerElement)
    }*/

  def nullFile(blockSize: Int, bytesPerElement: Int) =
    nullFiles().get((blockSize, bytesPerElement)).getOrElse {
      val a = createNullArray(blockSize, bytesPerElement)
      nullFiles.send(_ + ((blockSize -> bytesPerElement) -> a))
      a
    }
}