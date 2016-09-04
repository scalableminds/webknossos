package models.mturk

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.api.indexes.{Index, IndexType}

case class MTurkSQSQueue(name: String, url: String)

object MTurkSQSQueue extends FoxImplicits {
  implicit val mturkSQSQueueFormat = Json.format[MTurkSQSQueue]
}

object MTurkSQSQueueDAO extends SecuredBaseDAO[MTurkSQSQueue] with FoxImplicits {

  val collectionName = "mturkSQS"

  val formatter = MTurkSQSQueue.mturkSQSQueueFormat
}
