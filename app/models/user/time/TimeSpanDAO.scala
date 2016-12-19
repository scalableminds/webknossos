package models.user.time

import models.user.User
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.libs.json.Json
import reactivemongo.play.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import models.basics.SecuredBaseDAO
import reactivemongo.api.indexes.{IndexType, Index}

object TimeSpanDAO extends SecuredBaseDAO[TimeSpan] {

  val collectionName = "timeSpans"

  val formatter = TimeSpan.timeSpanFormat

  underlying.indexesManager.ensure(Index(List("timestamp" -> IndexType.Descending)))

  def intervalFilter(start: Option[Long], end: Option[Long]) = {

    if (start.isEmpty && end.isEmpty)
      Json.obj()
    else {
      val startFilter = start.map(s => Json.obj("$gte" -> s)) getOrElse Json.obj()
      val endFilter = end.map(e => Json.obj("$lte" -> e)) getOrElse Json.obj()

      Json.obj("timestamp" -> (startFilter ++ endFilter))
    }

  }

  def findByUser(user: User, start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) =
    withExceptionCatcher {
      find(Json.obj("_user" -> user._id) ++ intervalFilter(start, end)).cursor[TimeSpan]().collect[List]()
    }

  def findByAnnotation(annotation: String, start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) =
    withExceptionCatcher {
      find(Json.obj("annotation" -> annotation) ++ intervalFilter(start, end)).cursor[TimeSpan]().collect[List]()
    }

  def findAllBetween(start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) =
    withExceptionCatcher {
      find(intervalFilter(start, end)).cursor[TimeSpan]().collect[List]()
    }
}
