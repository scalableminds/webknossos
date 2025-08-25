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
import com.scalableminds.util.objectid.ObjectId
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
    emailChangeDate: Instant = Instant.now,
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
      novelUserExperienceInfos <- JsonHelper.parseAs[JsObject](r.noveluserexperienceinfos).toFox
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
        Instant.fromSql(r.emailchangedate),
        r.isdeleted
      )
    }

  def insertOne(u: MultiUser): Fox[Unit] =
    for {
      passwordInfoHasher <- PasswordHasherType.fromString(u.passwordInfo.hasher).toFox
      _ <- run(q"""INSERT INTO webknossos.multiusers(_id, email, passwordInfo_hasher,
                                                     passwordInfo_password,
                                                     isSuperUser, novelUserExperienceInfos, selectedTheme,
                                                     created, isEmailVerified, isDeleted)
                   VALUES(${u._id}, ${u.email}, $passwordInfoHasher,
                          ${u.passwordInfo.password},
                          ${u.isSuperUser}, ${u.novelUserExperienceInfos}, ${u.selectedTheme},
                          ${u.created}, ${u.isEmailVerified}, ${u.isDeleted})""".asUpdate)
    } yield ()

  def updatePasswordInfo(multiUserId: ObjectId, passwordInfo: PasswordInfo)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      passwordInfoHasher <- PasswordHasherType.fromString(passwordInfo.hasher).toFox
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET
                     passwordInfo_hasher = $passwordInfoHasher,
                     passwordInfo_password = ${passwordInfo.password}
                   WHERE _id = $multiUserId""".asUpdate)
    } yield ()

  def updateEmail(multiUserId: ObjectId, email: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET
                     email = $email,
                     isEmailVerified = false,
                     emailChangeDate = NOW()
                   WHERE _id = $multiUserId""".asUpdate)
    } yield ()

  def updateEmailVerification(multiUserId: ObjectId, verified: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET isemailverified = $verified
                   WHERE _id = $multiUserId""".asUpdate)
    } yield ()

  def updateLastLoggedInIdentity(multiUserId: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET _lastLoggedInIdentity = $userId
                   WHERE _id = $multiUserId""".asUpdate)
    } yield ()

  def updateNovelUserExperienceInfos(multiUserId: ObjectId, novelUserExperienceInfos: JsObject)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET novelUserExperienceInfos = $novelUserExperienceInfos
                   WHERE _id = $multiUserId""".asUpdate)
    } yield ()

  def updateSelectedTheme(multiUserId: ObjectId, selectedTheme: Theme)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET selectedTheme = $selectedTheme
                   WHERE _id = $multiUserId""".asUpdate)
    } yield ()

  def removeLastLoggedInIdentitiesWithOrga(organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.multiusers
                   SET _lastLoggedInIdentity = NULL
                   WHERE _lastLoggedInIdentity IN
                     (SELECT _id FROM webknossos.users WHERE _organization = $organizationId)""".asUpdate)
    } yield ()

  def findOneById(id: ObjectId)(implicit ctx: DBAccessContext): Fox[MultiUser] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[MultiusersRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext): Fox[MultiUser] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE email = $email AND $accessQuery".as[MultiusersRow])
      parsed <- parseFirst(r, email)
    } yield parsed

  def emailNotPresentYet(email: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      accessQuery <- readAccessQuery
      idList <- run(q"SELECT _id FROM $existingCollectionName WHERE email = $email AND $accessQuery".as[String])
    } yield idList.isEmpty

  def hasAtLeastOneActiveUser(multiUserId: ObjectId): Fox[Boolean] =
    for {
      idList <- run(q"""SELECT u._id
                        FROM webknossos.multiUsers_ m
                        JOIN webknossos.users_ u ON u._multiUser = m._id
                        WHERE m._id = $multiUserId
                        AND NOT u.isDeactivated""".as[String])
    } yield idList.nonEmpty

  def lastActivity(multiUserId: ObjectId): Fox[Instant] =
    for {
      lastActivityList <- run(q"""SELECT MAX(u.lastActivity)
                                  FROM webknossos.multiUsers_ m
                                  JOIN webknossos.users_ u ON u._multiUser = m._id
                                  WHERE m._id = $multiUserId
                                  AND NOT u.isDeactivated
                                  GROUP BY m._id""".as[Instant])
      head <- lastActivityList.headOption.toFox
    } yield head
}
