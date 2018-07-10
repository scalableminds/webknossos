package models.analytics

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

case class AnalyticsEntrySQL(
                              _id: ObjectId,
                              _user: Option[ObjectId],
                              namespace: String,
                              value: JsValue,
                              created: Long = System.currentTimeMillis(),
                              isDeleted: Boolean = false
                             )

object AnalyticsSQLDAO extends SQLDAO[AnalyticsEntrySQL, AnalyticsRow, Analytics] {
  val collection = Analytics

  def idColumn(x: Analytics): Rep[String] = x._Id
  def isDeletedColumn(x: Analytics): Rep[Boolean] = x.isdeleted

  def parse(r: AnalyticsRow): Fox[AnalyticsEntrySQL] =
    Fox.successful(AnalyticsEntrySQL(
        ObjectId(r._Id),
        r._User.map(ObjectId(_)),
        r.namespace,
        Json.parse(r.value),
        r.created.getTime,
        r.isdeleted
      ))

  def insertOne(a: AnalyticsEntrySQL): Fox[Unit] = {
    for {
      _ <- run(sqlu"""insert into webknossos.analytics(_id, _user, namespace, value, created, isDeleted)
                         values(${a._id.toString}, ${a._user.map(_.id)}, ${a.namespace}, #${sanitize(a.value.toString)},
                                ${new java.sql.Timestamp(a.created)}, ${a.isDeleted})""")
    } yield ()
  }
}
