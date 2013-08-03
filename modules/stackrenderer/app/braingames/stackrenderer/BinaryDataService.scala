package braingames.stackrenderer

import braingames.binary.api.{BinaryDataService => AbstractBinaryDataService}
import play.api.libs.concurrent.Akka
import play.api.Play
import models.stackrenderer.InMemoryDataSetRepository

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 26.07.13
 * Time: 18:18
 */
object BinaryDataService extends AbstractBinaryDataService {
  def system = Akka.system(Play.current)

  lazy val config = Play.current.configuration.underlying

  lazy val dataSetRepository = InMemoryDataSetRepository
}
