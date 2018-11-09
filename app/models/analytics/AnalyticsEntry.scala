package models.analytics

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.libs.json.{JsValue, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class AnalyticsEntry(
    _id: ObjectId,
    _user: Option[ObjectId],
    namespace: String,
    value: JsValue,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
)

class AnalyticsDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AnalyticsEntry, AnalyticsRow, Analytics](sqlClient) {
  val collection = Analytics

  def idColumn(x: Analytics): Rep[String] = x._Id
  def isDeletedColumn(x: Analytics): Rep[Boolean] = x.isdeleted

  def parse(r: AnalyticsRow): Fox[AnalyticsEntry] =
    Fox.successful(
      AnalyticsEntry(
        ObjectId(r._Id),
        r._User.map(ObjectId(_)),
        r.namespace,
        Json.parse(r.value),
        r.created.getTime,
        r.isdeleted
      ))

  def insertOne(a: AnalyticsEntry): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.analytics(_id, _user, namespace, value, created, isDeleted)
                         values(${a._id.toString}, ${a._user.map(_.id)}, ${a.namespace}, #${sanitize(a.value.toString)},
                                ${new java.sql.Timestamp(a.created)}, ${a.isDeleted})""")
    } yield ()
}
