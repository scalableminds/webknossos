package models.user

import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, JsonHelper}
import javax.inject.Inject
import slick.jdbc.PostgresProfile.api._
import com.scalableminds.webknossos.schema.Tables._
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.JsObject
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class MultiUser(
    _id: ObjectId,
    email: String,
    passwordInfo: PasswordInfo,
    isSuperUser: Boolean,
    _lastLoggedInIdentity: Option[ObjectId] = None,
    novelUserExperienceInfos: Option[JsObject] = None,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
)

class MultiUserDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[MultiUser, MultiusersRow, Multiusers](sqlClient) {
  val collection = Multiusers

  def idColumn(x: Multiusers): Rep[String] = x._Id
  def isDeletedColumn(x: Multiusers): Rep[Boolean] = x.isdeleted

  def parse(r: MultiusersRow): Fox[MultiUser] =
    for {
      novelUserExperienceInfosOpt <- Fox.runOptional(r.noveluserexperienceinfos)(JsonHelper.parseJsonToFox[JsObject](_))
    } yield {
      MultiUser(
        ObjectId(r._Id),
        r.email,
        PasswordInfo(r.passwordinfoHasher, r.passwordinfoPassword),
        r.issuperuser,
        r._Lastloggedinidentity.map(ObjectId(_)),
        novelUserExperienceInfosOpt,
        r.created.getTime,
        r.isdeleted
      )
    }

  def insertOne(u: MultiUser): Fox[Unit] = {
    val novelUserExperienceInfosString: Option[String] = u.novelUserExperienceInfos.map(_.toString).map(sanitize)
    for {
      _ <- run(sqlu"""insert into webknossos.multiusers(_id, email, passwordInfo_hasher, passwordInfo_password,
                       isSuperUser, novelUserExperienceInfos, created, isDeleted)
                     values(${u._id}, ${u.email}, '#${sanitize(u.passwordInfo.hasher)}', ${u.passwordInfo.password},
                      ${u.isSuperUser}, #${optionLiteral(novelUserExperienceInfosString)},
                     ${new java.sql.Timestamp(u.created)}, ${u.isDeleted})
          """)
    } yield ()
  }

  def updatePasswordInfo(multiUserId: ObjectId, passwordInfo: PasswordInfo)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(sqlu"""update webknossos.multiusers set
                          passwordInfo_hasher = '#${sanitize(passwordInfo.hasher)}',
                          passwordInfo_password = ${passwordInfo.password}
                      where _id = $multiUserId""")
    } yield ()

  def updateEmail(multiUserId: ObjectId, email: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(sqlu"""update webknossos.multiusers set
                          email = $email
                      where _id = $multiUserId""")
    } yield ()

  def updateLastLoggedInIdentity(multiUserId: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(sqlu"""update webknossos.multiusers set
                            _lastLoggedInIdentity = $userId
                        where _id = $multiUserId""")
    } yield ()

  def updateNovelUserExperienceInfos(multiUserId: ObjectId, novelUserExperienceInfos: Option[JsObject])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      novelUserExperienceInfosString = novelUserExperienceInfos.map(_.toString).map(sanitize)
      _ <- run(sqlu"""update webknossos.multiusers set
                            novelUserExperienceInfos = #${optionLiteral(novelUserExperienceInfosString)}
                        where _id = $multiUserId""")
    } yield ()

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext): Fox[MultiUser] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #$columns from #$existingCollectionName where email = $email and #$accessQuery".as[MultiusersRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def emailNotPresentYet(email: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      accessQuery <- readAccessQuery
      idList <- run(sql"select _id from #$existingCollectionName where email = $email and #$accessQuery".as[Int])
    } yield idList.isEmpty

}
