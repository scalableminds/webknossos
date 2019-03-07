package models.binary

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
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

class PublicationService @Inject()()(implicit ec: ExecutionContext) {
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

  def insertOne(p: Publication): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.publications(_id, publicationDate, imageUrl, title, description, created, isDeleted)
                         values(${p._id.id}, ${p.publicationDate
          .map(new java.sql.Timestamp(_))}, ${p.imageUrl}, ${p.title}, ${p.description}, ${new java.sql.Timestamp(
          p.created)}, ${p.isDeleted})""")
    } yield ()
}
