package models.user

import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper}

import javax.inject.Inject
import slick.jdbc.PostgresProfile.api._
import com.scalableminds.webknossos.schema.Tables._
import models.user.Theme.Theme
import play.api.libs.json.Format.GenericFormat
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

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
    isDeleted: Boolean = false
)

class MultiUserDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[MultiUser, MultiusersRow, Multiusers](sqlClient) {
  val collection = Multiusers

  def idColumn(x: Multiusers): Rep[String] = x._Id
  def isDeletedColumn(x: Multiusers): Rep[Boolean] = x.isdeleted

  def parse(r: MultiusersRow): Fox[MultiUser] =
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
        r.isdeleted
      )
    }

  def insertOne(u: MultiUser): Fox[Unit] = {
    val novelUserExperienceInfosString = sanitize(u.novelUserExperienceInfos.toString)
    for {
      _ <- run(sqlu"""insert into webknossos.multiusers(_id, email, passwordInfo_hasher, passwordInfo_password,
                       isSuperUser, novelUserExperienceInfos, selectedTheme, created, isDeleted)
                     values(${u._id}, ${u.email}, '#${sanitize(u.passwordInfo.hasher)}', ${u.passwordInfo.password},
                      ${u.isSuperUser}, '#$novelUserExperienceInfosString', '#${u.selectedTheme}',
                     ${u.created}, ${u.isDeleted})
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

  def updateNovelUserExperienceInfos(multiUserId: ObjectId, novelUserExperienceInfos: JsObject)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      novelUserExperienceInfosString = sanitize(novelUserExperienceInfos.toString)
      _ <- run(sqlu"""update webknossos.multiusers set
                            novelUserExperienceInfos = '#$novelUserExperienceInfosString'
                        where _id = $multiUserId""")
    } yield ()

  def updateSelectedTheme(multiUserId: ObjectId, selectedTheme: Theme)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(multiUserId)
      _ <- run(sqlu"""update webknossos.multiusers set
                            selectedTheme = '#$selectedTheme'
                        where _id = $multiUserId""")
    } yield ()

  def removeLastLoggedInIdentitiesWithOrga(organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(sqlu"""
        update webknossos.multiusers set _lastLoggedInIdentity = null
        where _lastLoggedInIdentity in
         (select _id from webknossos.users where _organization = $organizationId)
        """)
    } yield ()

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext): Fox[MultiUser] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select #$columns from #$existingCollectionName where email = $email and #$accessQuery".as[MultiusersRow])
      parsed <- parseFirst(r, email)
    } yield parsed

  def emailNotPresentYet(email: String)(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      accessQuery <- readAccessQuery
      idList <- run(sql"select _id from #$existingCollectionName where email = $email and #$accessQuery".as[String])
    } yield idList.isEmpty

  def hasAtLeastOneActiveUser(multiUserId: ObjectId): Fox[Boolean] =
    for {
      idList <- run(sql"""select u._id
             from webknossos.multiUsers_ m
             join webknossos.users_ u on u._multiUser = m._id
             where m._id = $multiUserId
             and not u.isDeactivated""".as[String])
    } yield idList.nonEmpty

  def lastActivity(multiUserId: ObjectId): Fox[Instant] =
    for {
      lastActivityList <- run(sql"""select max(u.lastActivity)
             from webknossos.multiUsers_ m
             join webknossos.users_ u on u._multiUser = m._id
             where m._id = $multiUserId
             and not u.isDeactivated
             group by m._id
             """.as[Instant])
      head <- lastActivityList.headOption.toFox
    } yield head
}
