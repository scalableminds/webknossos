package models.mturk

import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import play.api.libs.json.Json

case class MTurkSQSQueue(name: String, url: String)

object MTurkSQSQueue extends FoxImplicits {
  implicit val mturkSQSQueueFormat = Json.format[MTurkSQSQueue]
}

object MTurkSQSQueueDAO extends SecuredBaseDAO[MTurkSQSQueue] with FoxImplicits {

  val collectionName = "mturkSQS"

  val formatter = MTurkSQSQueue.mturkSQSQueueFormat
}
