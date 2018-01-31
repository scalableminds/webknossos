package models.user.time

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.play.json.BSONFormats._
import utils.ObjectId

object TimeSpanDAO {
/*  underlying.indexesManager.ensure(Index(List("timestamp" -> IndexType.Descending)))
  underlying.indexesManager.ensure(Index(List("annotation" -> IndexType.Ascending)))*/

  def findByUser(user: User, start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) =
    for {
      timeSpansSQL <-TimeSpanSQLDAO.findAllByUser(ObjectId.fromBsonId(user._id), start, end)
      timeSpans <- Fox.combined(timeSpansSQL.map(TimeSpan.fromTimeSpanSQL(_)))
    } yield timeSpans

  def findByAnnotation(annotationId: String, start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) =
    for {
      timeSpansSQL <-TimeSpanSQLDAO.findAllByAnnotation(ObjectId(annotationId), start, end)
      timeSpans <- Fox.combined(timeSpansSQL.map(TimeSpan.fromTimeSpanSQL(_)))
    } yield timeSpans

  def findAllBetween(start: Option[Long], end: Option[Long])(implicit ctx: DBAccessContext) =
    for {
      timeSpansSQL <-TimeSpanSQLDAO.findAll(start, end)
      timeSpans <- Fox.combined(timeSpansSQL.map(TimeSpan.fromTimeSpanSQL(_)))
    } yield timeSpans

  def insert(timeSpan: TimeSpan)(implicit ctx: DBAccessContext) = {
    for {
      timeSpanSQL<- TimeSpanSQL.fromTimeSpan(timeSpan)
      _ <- TimeSpanSQLDAO.insertOne(timeSpanSQL)
    } yield ()
  }

  def update(timeSpan: TimeSpan)(implicit ctx: DBAccessContext) = {
    for {
      timeSpanSQL <- TimeSpanSQL.fromTimeSpan(timeSpan)
      _ <- TimeSpanSQLDAO.updateOne(timeSpanSQL)
    } yield ()
  }
}
