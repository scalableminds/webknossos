package models.user.time

import models.user.User
import braingames.reactivemongo.DBAccessContext
import play.api.libs.json.Json
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import models.basics.SecuredBaseDAO
import reactivemongo.api.indexes.{IndexType, Index}

object TimeSpanDAO extends SecuredBaseDAO[TimeSpan]{

  val collectionName = "timeSpans"

  val formatter = TimeSpan.timeSpanFormat

  underlying.indexesManager.ensure(Index(List("timestamp" -> IndexType.Descending)))

  def findByUser(user: User)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find("_user", user._id).collect[List]()
  }

  def findAllBetween(start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) = withExceptionCatcher{
    val startFilter = start.map(s => Json.obj("timestamp" -> Json.obj("$gte" -> s))) getOrElse Json.obj()
    val endFilter = end.map(e => Json.obj("timestamp" -> Json.obj("$lte" -> e))) getOrElse Json.obj()

    find(startFilter ++ endFilter).cursor[TimeSpan].collect[List]()
  }
}