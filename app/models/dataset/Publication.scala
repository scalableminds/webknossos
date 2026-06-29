package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Publications, PublicationsRow, GetResultPublicationsRow}
import models.annotation.{AnnotationDAO, AnnotationService}
import play.api.http.Status.NOT_FOUND
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.{JsObject, Json, JsArray}
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class Publication(
    _id: ObjectId,
    publicationDate: Option[Instant],
    imageUrl: Option[String],
    title: Option[String],
    description: Option[String],
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class PublicationService @Inject() (
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    annotationService: AnnotationService,
    annotationDAO: AnnotationDAO
)(implicit ec: ExecutionContext) {

  def publicWrites(publication: Publication): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      datasets <- datasetDAO.findAllByPublication(publication._id) ?~> "not found" ~> NOT_FOUND
      annotations <- annotationDAO.findAllByPublication(publication._id) ?~> "not found" ~> NOT_FOUND
      datasetsJson <- Fox.serialCombined(datasets)(d => datasetService.publicWrites(d, None))
      annotationsJson <- Fox.serialCombined(annotations) { annotation =>
        annotationService.writesWithDataset(annotation)
      }
    } yield Json.obj(
      "id" -> publication._id.id,
      "publicationDate" -> publication.publicationDate,
      "imageUrl" -> publication.imageUrl,
      "title" -> publication.title,
      "description" -> publication.description,
      "created" -> publication.created,
      "datasets" -> JsArray(datasetsJson),
      "annotations" -> JsArray(annotationsJson)
    )
  }
}

class PublicationDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Publication, PublicationsRow, Publications](sqlClient) {
  protected val collection = Publications
  protected def resultConverter = GetResultPublicationsRow

  override protected def anonymousReadAccessQ(sharingToken: Option[String]): SqlToken = q"TRUE"

  protected def parse(r: PublicationsRow): Fox[Publication] =
    Fox.successful(
      Publication(
        ObjectId(r._id),
        r.publicationdate.map(Instant.fromSql),
        r.imageurl,
        r.title,
        r.description,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    )

  def insertOne(p: Publication): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.publications(_id, publicationDate, imageUrl, title, description, created, isDeleted)
            VALUES(${p._id}, ${p.publicationDate}, ${p.imageUrl}, ${p.title}, ${p.description}, ${p.created}, ${p.isDeleted})""".asUpdate
      )
    } yield ()
}
