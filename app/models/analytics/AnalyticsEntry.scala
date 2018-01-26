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

object AnalyticsEntrySQL {
  def fromAnalyticsEntry(a: AnalyticsEntry) =
    Fox.successful(AnalyticsEntrySQL(
      ObjectId.fromBsonId(BSONObjectID.generate),
      a.user.map(ObjectId.fromBsonId(_)),
      a.namespace,
      a.value,
      a.timestamp,
      true
    ))
}

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
      _ <- db.run(sqlu"""insert into webknossos.analytics(_id, _user, namespace, value, created, isDeleted)
                         values(${a._id.toString}, ${a._user.map(_.id)}, ${a.namespace}, #${sanitize(a.value.toString)},
                                ${new java.sql.Timestamp(a.created)}, ${a.isDeleted})""")
    } yield ()
  }
}





case class AnalyticsEntry(
                           user: Option[BSONObjectID],
                           namespace: String,
                           value: JsValue,
                           timestamp: Long = System.currentTimeMillis()
                         )

object AnalyticsEntry {
  implicit val analyticsEntryFormat = Json.format[AnalyticsEntry]

  def fromAnalyticsEntrySQL(s: AnalyticsEntrySQL)(implicit ctx: DBAccessContext): Fox[AnalyticsEntry] =
    Fox.successful(AnalyticsEntry(
      s._user.map(_.toBSONObjectId).flatten,
      s.namespace,
      s.value,
      s.created
    ))
}

object AnalyticsDAO {

  def insert(analyticsEntry: AnalyticsEntry) = {
    for {
      analyticsEntrySQL <- AnalyticsEntrySQL.fromAnalyticsEntry(analyticsEntry)
      _ <- AnalyticsSQLDAO.insertOne(analyticsEntrySQL)
    } yield ()
  }

}
