package models.binary

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class Publication(_id: ObjectId,
                       publicationDate: Option[Long],
                       imageUrl: Option[String],
                       title: Option[String],
                       details: Option[String],
                       created: Long = System.currentTimeMillis(),
                       isDeleted: Boolean = false)

class PublicationService @Inject()()(implicit ec: ExecutionContext) {
  def publicWrites(p: Publication): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> p._id.id,
        "publicationDate" -> p.publicationDate,
        "imageUrl" -> p.imageUrl,
        "title" -> p.title,
        "details" -> p.details,
        "created" -> p.created
      ))
}

class PublicationDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Publication, PublicationsRow, Publications](sqlClient) {
  val collection = Publications

  def idColumn(x: Publications): Rep[String] = x._Id

  def isDeletedColumn(x: Publications): Rep[Boolean] = x.isdeleted

  def parse(r: PublicationsRow): Fox[Publication] =
    Fox.successful(
      Publication(
        ObjectId(r._Id),
        r.publicationdate.map(_.getTime),
        r.imageurl,
        r.title,
        r.details,
        r.created.getTime,
        r.isdeleted
      )
    )
}
