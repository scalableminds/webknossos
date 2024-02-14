package models.user

import play.silhouette.api.util.PasswordInfo
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.schema.Tables._
import models.user.Theme.Theme
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class MultiUser(
    _id: ObjectId,
    email: String,
    passwordInfo: PasswordInfo,
    isSuperUser: Boolean,
    _lastLoggedInIdentity: Option[ObjectId] = None,
    novelUserExperienceInfos: JsObject = Json.obj(),
    selectedTheme: Theme = Theme.auto,
    created: Instant = Instant.now,
    isEmailVerified: Boolean = false,
    isDeleted: Boolean = false
)

object PasswordHasherType extends ExtendedEnumeration {
  type PasswordHasher = Value

  val SCrypt, Empty = Value
}

class MultiUserDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[MultiUser, MultiusersRow, Multiusers](sqlClient) {
  protected val collection = Multiusers

  protected def idColumn(x: Multiusers): Rep[String] = x._Id
  protected def isDeletedColumn(x: Multiusers): Rep[Boolean] = x.isdeleted

  protected def parse(r: MultiusersRow): Fox[MultiUser] =
    for {
      novelUserExperienceInfos <- JsonHelper.parseAndValidateJson[JsObject](r.noveluserexperienceinfos).toFox
      theme <- Theme.fromString(r.selectedtheme).toFox
    } yield {
      MultiUser(
        ObjectId(r._Id),
        r.email,
        PasswordInfo(r.passwordinfoHasher, r.passwordinfoPassword),
        r.issuperuser,
        r._Lastloggedinidentity.map(ObjectId(_)),
        novelUserExperienceInfos,
        theme,
        Instant.fromSql(r.created),
        r.isemailverified,
        r.isdeleted
      )
    }

  def insertOne(u: MultiUser): Fox[Unit] =
    for {
      passwordInfoHasher <- PasswordHasherType.fromString(u.passwordInfo.hasher).toFox
      _ <- run(q"""insert into webknossos.multiusers(_id, email, passwordInfo_hasher,
                                                     passwordInfo_password,
                                                     isSuperUser, novelUserExperienceInfos, selectedTheme,
                                                     created, isEmailVerified, isDeleted)
                   values(${u._id}, ${u.email}, $passwordInfoHasher,
                          ${u.passwordInfo.password},
                          ${u.isSuperUser}, ${u.novelUserExperienceInfos}, ${u.selectedTheme},
                          ${u.created}, ${u.isEmailVerified}, ${u.isDeleted})""".asUpdate)
    } yield ()

  def updatePasswordInfo(multiUserId: ObjectId, passwordInfo: PasswordInfo)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      passwordInfoHasher <- PasswordHasherType.fromString(passwordInfo.hasher).toFox
      _ <- run(q"""update webknossos.multiusers set
                          passwordInfo_hasher = $passwordInfoHasher,
                          passwordInfo_password = ${passwordInfo.password}
                   where _id = $multiUserId""".asUpdate)
    } yield ()

  def updateEmail(multiUserId: ObjectId, email: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""update webknossos.multiusers set
                          email = $email, isEmailVerified = false
                   where _id = $multiUserId""".asUpdate)
    } yield ()

  def updateEmailVerification(multiUserId: ObjectId, verified: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""update webknossos.multiusers set
                          isemailverified = $verified
                   where _id = $multiUserId""".asUpdate)
    } yield ()

  def updateLastLoggedInIdentity(multiUserId: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""update webknossos.multiusers set
                          _lastLoggedInIdentity = $userId
                   where _id = $multiUserId""".asUpdate)
    } yield ()

  def updateNovelUserExperienceInfos(multiUserId: ObjectId, novelUserExperienceInfos: JsObject)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""update webknossos.multiusers set
                          novelUserExperienceInfos = $novelUserExperienceInfos
                   where _id = $multiUserId""".asUpdate)
    } yield ()

  def updateSelectedTheme(multiUserId: ObjectId, selectedTheme: Theme)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""update webknossos.multiusers set
                          selectedTheme = $selectedTheme
                   where _id = $multiUserId""".asUpdate)
    } yield ()

  def removeLastLoggedInIdentitiesWithOrga(organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""
        update webknossos.multiusers set _lastLoggedInIdentity = null
        where _lastLoggedInIdentity in
         (select _id from webknossos.users where _organization = $organizationId)
        """.asUpdate)
    } yield ()

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext): Fox[MultiUser] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where email = $email and $accessQuery".as[MultiusersRow])
      parsed <- parseFirst(r, email)
    } yield parsed

  def emailNotPresentYet(email: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      accessQuery <- readAccessQuery
      idList <- run(q"select _id from $existingCollectionName where email = $email and $accessQuery".as[String])
    } yield idList.isEmpty

  def hasAtLeastOneActiveUser(multiUserId: ObjectId): Fox[Boolean] =
    for {
      idList <- run(q"""select u._id
                        from webknossos.multiUsers_ m
                        join webknossos.users_ u on u._multiUser = m._id
                        where m._id = $multiUserId
                        and not u.isDeactivated""".as[String])
    } yield idList.nonEmpty

  def lastActivity(multiUserId: ObjectId): Fox[Instant] =
    for {
      lastActivityList <- run(q"""select max(u.lastActivity)
                                    from webknossos.multiUsers_ m
                                    join webknossos.users_ u on u._multiUser = m._id
                                    where m._id = $multiUserId
                                    and not u.isDeactivated
                                    group by m._id
                                    """.as[Instant])
      head <- lastActivityList.headOption.toFox
    } yield head
}
