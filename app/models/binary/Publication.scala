package models.binary

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import models.annotation.{AnnotationDAO, AnnotationService}
import play.api.http.Status.NOT_FOUND
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class Publication(_id: ObjectId,
                       publicationDate: Option[Long],
                       imageUrl: Option[String],
                       title: Option[String],
                       description: Option[String],
                       created: Long = System.currentTimeMillis(),
                       isDeleted: Boolean = false)

class CompactPublicationService @Inject()()(implicit ec: ExecutionContext) {
  // TODO Does the dataset need to know the publication?
  def publicWrites(p: Publication): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> p._id.id,
        "publicationDate" -> p.publicationDate,
        "imageUrl" -> p.imageUrl,
        "title" -> p.title,
        "description" -> p.description,
        "created" -> p.created
      ))
}

class PublicationService @Inject()(dataSetService: DataSetService,
                                   dataSetDAO: DataSetDAO,
                                   annotationService: AnnotationService,
                                   annotationDAO: AnnotationDAO)(implicit ec: ExecutionContext) {

  def publicWritesWithDatasetsAndAnnotations(publication: Publication): Fox[JsObject] = {
    implicit val ctx: DBAccessContext = GlobalAccessContext
    for {
      dataSets <- dataSetDAO.findAllByPublication(publication._id) ?~> "not found" ~> NOT_FOUND
      annotations <- annotationDAO.findAllByPublication(publication._id) ?~> "not found" ~> NOT_FOUND
      dataSetsJson <- Fox.serialCombined(dataSets)(d => dataSetService.publicWrites(d, None, None, None))
      annotationsJson <- Fox.serialCombined(annotations) { annotation =>
        annotationService.writesWithDataset(annotation)
      }
    } yield
      Json.obj(
        "id" -> publication._id.id,
        "publicationDate" -> publication.publicationDate,
        "imageUrl" -> publication.imageUrl,
        "title" -> publication.title,
        "description" -> publication.description,
        "created" -> publication.created,
        "datasets" -> dataSetsJson,
        "annotations" -> annotationsJson
      )
  }
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
        r.description,
        r.created.getTime,
        r.isdeleted
      )
    )

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Publication] =
    for {
      r <- run(sql"select #$columns from #$existingCollectionName where _id = ${id.id}".as[PublicationsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Publication]] =
    for {
      r <- run(sql"select #$columns from #$existingCollectionName".as[PublicationsRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(p: Publication): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.publications(_id, publicationDate, imageUrl, title, description, created, isDeleted)
                         values(${p._id.id}, ${p.publicationDate
          .map(new java.sql.Timestamp(_))}, ${p.imageUrl}, ${p.title}, ${p.description}, ${new java.sql.Timestamp(
          p.created)}, ${p.isDeleted})""")
    } yield ()
}
