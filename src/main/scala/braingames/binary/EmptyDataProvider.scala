package braingames.binary

import akka.agent.Agent
import akka.actor.ActorSystem
import braingames.binary.models.DataLayer
import braingames.binary.models.DataSource
import scala.concurrent.ExecutionContext.Implicits._

trait EmptyDataProvider {
  implicit val sys: ActorSystem

  lazy val nullFiles = Agent[Map[(Int, Int), Array[Byte]]](Map.empty)

  def loadNullBlock(dataSource: DataSource, dataLayer: DataLayer): Array[Byte] = {
    nullFile(dataSource.blockSize, dataLayer.bytesPerElement)
  }

  def createNullArray(blockSize: Int, bytesPerElement: Int) =
    new Array[Byte](blockSize * bytesPerElement)

  def nullFile(blockSize: Int, bytesPerElement: Int) =
    createNullArray(blockSize, bytesPerElement)
    //nullFiles().get((blockSize, bytesPerElement)).getOrElse {
    //  val a = createNullArray(blockSize, bytesPerElement)
    //  nullFiles.send(_ + ((blockSize -> bytesPerElement) -> a))
    //  a
    //}
}