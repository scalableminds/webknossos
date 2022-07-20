package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{AnnotationPrivateLinks, _}

import javax.inject.Inject
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class AnnotationPrivateLink(_id: ObjectId,
                                 _annotation: ObjectId,
                                 value: String,
                                 expirationDateTime: Long = System.currentTimeMillis(),
                                 isDeleted: Boolean = false)

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
                         values(${aPL._id.id}, ${aPL._annotation.id}, ${aPL.value}, ${new java.sql.Timestamp(
          aPL.expirationDateTime)}, ${aPL.isDeleted})""")
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
