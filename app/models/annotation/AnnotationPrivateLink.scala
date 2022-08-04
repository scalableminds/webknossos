package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{AnnotationPrivateLinks, _}

import javax.inject.Inject
import play.api.libs.json.{JsValue, Json, OFormat}
import play.api.mvc.PlayBodyParsers
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class AnnotationPrivateLink(_id: ObjectId,
                                 _annotation: ObjectId,
                                 accessToken: String,
                                 // TODO check everything
                                 expirationDateTime: Option[Long],
                                 isDeleted: Boolean = false)

case class AnnotationPrivateLinkParams(_annotation: ObjectId, expirationDateTime: Option[Long])

object AnnotationPrivateLink {
  implicit val jsonFormat: OFormat[AnnotationPrivateLink] = Json.format[AnnotationPrivateLink]
}

class AnnotationPrivateLinkService @Inject()()(implicit ec: ExecutionContext, val bodyParsers: PlayBodyParsers) {

  val DefaultAnnotationListLimit = 1000
  def publicWrites(annotationPrivateLink: AnnotationPrivateLink): Fox[JsValue] =
    Fox.successful(Json.toJson(annotationPrivateLink))
}

class AnnotationPrivateLinkDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AnnotationPrivateLink, AnnotationPrivateLinksRow, AnnotationPrivateLinks](sqlClient) {
  val collection = AnnotationPrivateLinks

  def idColumn(x: AnnotationPrivateLinks): Rep[String] = x._Id

  def isDeletedColumn(x: AnnotationPrivateLinks): Rep[Boolean] = x.isdeleted

  def parse(r: AnnotationPrivateLinksRow): Fox[AnnotationPrivateLink] =
    Fox.successful(
      AnnotationPrivateLink(
        ObjectId(r._Id),
        ObjectId(r._Annotation),
        r.value,
        r.expirationdatetime.getTime,
        r.isdeleted
      )
    )

  def insertOne(aPL: AnnotationPrivateLink): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.annotation_private_links(_id, _annotation, value, expirationDateTime, isDeleted)
                         values(${aPL._id.id}, ${aPL._annotation.id}, ${aPL.accessToken}, ${new java.sql.Timestamp(
          aPL.expirationDateTime)}, ${aPL.isDeleted})""")
    } yield ()

  def updateOne(id: ObjectId,
                _annotation: ObjectId,
                expirationDateTime: Option[Long])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"""update webknossos.annotation_private_links set _annotation = ${_annotation},
                            expirationDateTime = $expirationDateTime where _id = $id""")
    } yield ()

  def findOneByAccessId(accessId: String)(implicit ctx: DBAccessContext): Fox[AnnotationPrivateLink] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select #$columns from #$existingCollectionName where value = ${accessId} and #$accessQuery"
          .as[AnnotationPrivateLinksRow])
      parsed <- parseFirst(r, accessId)
    } yield parsed
}
