package models.dataset

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.{AnnotationDAO, AnnotationService}
import play.api.http.Status.NOT_FOUND
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.{JsArray, JsObject, Json}
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

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
      datasetsJson <- Fox.serialCombined(datasets)(d => datasetService.publicWrites(d, None, None, None))
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

  protected def idColumn(x: Publications): Rep[String] = x._Id
  protected def isDeletedColumn(x: Publications): Rep[Boolean] = x.isdeleted
  protected def getResult = GetResultPublicationsRow

  protected def parse(r: PublicationsRow): Fox[Publication] =
    Fox.successful(
      Publication(
        ObjectId(r._Id),
        r.publicationdate.map(Instant.fromSql),
        r.imageurl,
        r.title,
        r.description,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    )

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Publication] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id".as[PublicationsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Publication]] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName".as[PublicationsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(p: Publication): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.publications(_id, publicationDate, imageUrl, title, description, created, isDeleted)
            VALUES(${p._id}, ${p.publicationDate}, ${p.imageUrl}, ${p.title}, ${p.description}, ${p.created}, ${p.isDeleted})""".asUpdate
      )
    } yield ()
}
