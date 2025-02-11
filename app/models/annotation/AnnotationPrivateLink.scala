package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import play.api.libs.json.{JsValue, Json, OFormat}
import security.RandomIDGenerator
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AnnotationPrivateLink(
    _id: ObjectId,
    _annotation: ObjectId,
    accessToken: String,
    expirationDateTime: Option[Instant],
    isDeleted: Boolean = false
)

object AnnotationPrivateLink {
  implicit val jsonFormat: OFormat[AnnotationPrivateLink] = Json.format[AnnotationPrivateLink]
}

case class AnnotationPrivateLinkParams(annotation: String, expirationDateTime: Option[Instant])

object AnnotationPrivateLinkParams {
  implicit val jsonFormat: OFormat[AnnotationPrivateLinkParams] = Json.format[AnnotationPrivateLinkParams]
}

class AnnotationPrivateLinkService @Inject() ()(implicit ec: ExecutionContext) {
  def publicWrites(annotationPrivateLink: AnnotationPrivateLink): Fox[JsValue] =
    Fox.successful(
      Json.obj(
        "id" -> annotationPrivateLink._id.toString,
        "annotation" -> annotationPrivateLink._annotation.toString,
        "accessToken" -> annotationPrivateLink.accessToken,
        "expirationDateTime" -> annotationPrivateLink.expirationDateTime
      )
    )

  def generateToken: String = RandomIDGenerator.generateBlocking(12)
}

class AnnotationPrivateLinkDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AnnotationPrivateLink, AnnotationPrivatelinksRow, AnnotationPrivatelinks](sqlClient) {
  protected val collection = AnnotationPrivatelinks

  protected def idColumn(x: AnnotationPrivatelinks): Rep[String] = x._Id

  protected def isDeletedColumn(x: AnnotationPrivatelinks): Rep[Boolean] = x.isdeleted

  protected def getResult = GetResultAnnotationPrivatelinksRow

  protected def parse(r: AnnotationPrivatelinksRow): Fox[AnnotationPrivateLink] =
    Fox.successful(
      AnnotationPrivateLink(
        ObjectId(r._Id),
        ObjectId(r._Annotation),
        r.accesstoken,
        r.expirationdatetime.map(Instant.fromSql),
        r.isdeleted
      )
    )

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""(_annotation IN (SELECT _id FROM webknossos.annotations_ WHERE _user = $requestingUserId))"""

  def insertOne(aPL: AnnotationPrivateLink): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.annotation_privateLinks
                     (_id, _annotation, accessToken, expirationDateTime, isDeleted)
                   VALUES(${aPL._id}, ${aPL._annotation}, ${aPL.accessToken}, ${aPL.expirationDateTime}, ${aPL.isDeleted})""".asUpdate
      )
    } yield ()

  def updateOne(id: ObjectId, annotationId: ObjectId, expirationDateTime: Option[Instant])(implicit
      ctx: DBAccessContext
  ): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""UPDATE webknossos.annotation_privateLinks
                   SET
                     _annotation = $annotationId,
                     expirationDateTime = $expirationDateTime
                   WHERE _id = $id""".asUpdate)
    } yield ()

  override def findAll(implicit ctx: DBAccessContext): Fox[List[AnnotationPrivateLink]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns FROM $existingCollectionName WHERE $accessQuery""".as[AnnotationPrivatelinksRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByAnnotation(annotationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[AnnotationPrivateLink]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"""SELECT $columns FROM $existingCollectionName WHERE _annotation = $annotationId AND $accessQuery"""
          .as[AnnotationPrivatelinksRow]
      )
      parsed <- parseAll(r)
    } yield parsed

  def findOneByAccessToken(accessToken: String): Fox[AnnotationPrivateLink] =
    for {
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE accessToken = $accessToken".as[AnnotationPrivatelinksRow]
      )
      parsed <- parseFirst(r, accessToken)
    } yield parsed
}
