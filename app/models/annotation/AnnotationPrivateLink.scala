package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{AnnotationPrivatelinks, _}
import oxalis.security.RandomIDGenerator

import javax.inject.Inject
import play.api.libs.json.{JsValue, Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class AnnotationPrivateLink(_id: ObjectId,
                                 _annotation: ObjectId,
                                 accessToken: String,
                                 expirationDateTime: Option[Long],
                                 isDeleted: Boolean = false)

object AnnotationPrivateLink {
  implicit val jsonFormat: OFormat[AnnotationPrivateLink] = Json.format[AnnotationPrivateLink]
}

case class AnnotationPrivateLinkParams(_annotation: String, expirationDateTime: Option[Long])

object AnnotationPrivateLinkParams {
  implicit val jsonFormat: OFormat[AnnotationPrivateLinkParams] = Json.format[AnnotationPrivateLinkParams]
}

class AnnotationPrivateLinkService @Inject()()(implicit ec: ExecutionContext) {
  def publicWrites(annotationPrivateLink: AnnotationPrivateLink): Fox[JsValue] =
    Fox.successful(
      Json.obj(
        "id" -> annotationPrivateLink._id.toString,
        "annotation" -> annotationPrivateLink._annotation.toString,
        "accessToken" -> annotationPrivateLink.accessToken,
        "expirationDateTime" -> annotationPrivateLink.expirationDateTime,
      ))

  def generateToken: String = RandomIDGenerator.generateBlocking(24)
}

class AnnotationPrivateLinkDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AnnotationPrivateLink, AnnotationPrivatelinksRow, AnnotationPrivatelinks](sqlClient) {
  val collection = AnnotationPrivatelinks

  def idColumn(x: AnnotationPrivatelinks): Rep[String] = x._Id

  def isDeletedColumn(x: AnnotationPrivatelinks): Rep[Boolean] = x.isdeleted

  def parse(r: AnnotationPrivatelinksRow): Fox[AnnotationPrivateLink] =
    Fox.successful(
      AnnotationPrivateLink(
        ObjectId(r._Id),
        ObjectId(r._Annotation),
        r.accesstoken,
        r.expirationdatetime.map(_.getTime),
        r.isdeleted
      )
    )

//  override def updateAccessQ(requestingUserId: ObjectId): String =
//    s"""exists(select _user from webknossos.annotations_ ant join webknossos.annotation_privateLinks aPL on ant._id = aPL._annotation where aPL._id = _id and ant._user = ${requestingUserId.id})"""

  def insertOne(aPL: AnnotationPrivateLink): Fox[Unit] = {
    val time = aPL.expirationDateTime.map(new java.sql.Timestamp(_))

    for {
      _ <- run(
        sqlu"""insert into webknossos.annotation_privateLinks(_id, _annotation, accessToken, expirationDateTime, isDeleted)
                         values(${aPL._id.id}, ${aPL._annotation.id}, ${aPL.accessToken}, ${time}, ${aPL.isDeleted})""")
    } yield ()
  }

  def updateOne(id: ObjectId, _annotation: ObjectId, expirationDateTime: Option[Long])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"""update webknossos.annotation_privateLinks set _annotation = ${_annotation},
                            expirationDateTime = $expirationDateTime where _id = $id""")
    } yield ()

  override def findAll(implicit ctx: DBAccessContext): Fox[List[AnnotationPrivateLink]] =
    for {
      userId <- userIdFromCtx ?~> "FAILED: userIdFromCtx"
      r <- run(sql"""select #$columns from #$existingCollectionName  where
          exists(select _user from webknossos.annotations_ ant join #$existingCollectionName aPL on ant._id = aPL._annotation where aPL._id = #$existingCollectionName._id and ant._user = ${userId.id})
           """.as[AnnotationPrivatelinksRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByAnnotation(annotationId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      userId <- userIdFromCtx ?~> "FAILED: userIdFromCtx"
      r <- run(sql"""select #$columns from #$existingCollectionName where
    exists(select _user from webknossos.annotations_ ant join #$existingCollectionName aPL on ant._id = aPL._annotation where aPL._id = #$existingCollectionName._id and ant._user = ${userId.id} and ant._id = ${annotationId.id})
     """.as[AnnotationPrivatelinksRow])
      parsed <- parseAll(r)
    } yield parsed

  def findOneByAccessToken(accessToken: String): Fox[AnnotationPrivateLink] =
    for {
      r <- run(
        sql"select #$columns from #$existingCollectionName where accessToken = ${accessToken}"
          .as[AnnotationPrivatelinksRow])
      parsed <- parseFirst(r, accessToken)
    } yield parsed
}
