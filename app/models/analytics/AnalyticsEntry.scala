package models.analytics

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import models.basics.SecuredBaseDAO
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

case class AnalyticsEntrySQL(
                            _id: ObjectId,
                            user: Option[ObjectId],
                            namespace: String,
                            value: JsValue,
                            created: Long = System.currentTimeMillis(),
                            isDeleted: Boolean = false
                             )


object AnnotationSQLDAO extends SQLDAO[AnalyticsEntrySQL, AnalyticsRow, Analytics] {
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
      s.user.map(_.toBSONObjectId).flatten,
      s.namespace,
      s.value,
      s.created
    ))
}

object AnalyticsDAO extends SecuredBaseDAO[AnalyticsEntry] {

  val collectionName = "analytics"

  implicit val formatter = AnalyticsEntry.analyticsEntryFormat
}
