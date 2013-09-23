package braingames.levelcreator

import braingames.binary.api.{BinaryDataService => AbstractBinaryDataService}
import play.api.libs.concurrent.Akka
import play.api.Play
import models.knowledge.DataSetRepository

object BinaryDataService extends AbstractBinaryDataService {
  def system = Akka.system(Play.current)

  lazy val config = Play.current.configuration.underlying

  lazy val dataSetRepository = DataSetRepository
}