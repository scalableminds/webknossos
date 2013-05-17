package oxalis.binary

import braingames.binary.api.{ BinaryDataService => AbstractBinaryDataService }
import models.binary.DataSetRepository
import play.api.libs.concurrent.Akka
import play.api.Play
import braingames.io.DataSetChangeHandler

object BinaryDataService extends AbstractBinaryDataService {
  def system = Akka.system(Play.current)
  
  lazy val config = Play.current.configuration.underlying
  
  object dataSetChangeHandler extends DataSetChangeHandler with DataSetRepository
}