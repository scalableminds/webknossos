package models.user

import com.mohiva.play.silhouette.api.{Identity, LoginInfo}
import com.scalableminds.util.accesscontext._
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonHelper.parseAndValidateJson
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.schema.Tables._

import javax.inject.Inject
import models.team._
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}
import utils.ObjectId

import scala.concurrent.ExecutionContext

object User {
  val default_login_provider_id: String = "credentials"
}

case class User(
    _id: ObjectId,
    _multiUser: ObjectId,
    _organization: ObjectId,
    firstName: String,
    lastName: String,
    lastActivity: Instant = Instant.now,
    userConfiguration: JsObject,
    loginInfo: LoginInfo,
    isAdmin: Boolean,
    isOrganizationOwner: Boolean,
    isDatasetManager: Boolean,
    isDeactivated: Boolean,
    isUnlisted: Boolean,
    created: Instant = Instant.now,
    lastTaskTypeId: Option[ObjectId] = None,
    isDeleted: Boolean = false
) extends DBAccessContextPayload
    with Identity
    with FoxImplicits {

  def toStringAnonymous: String = s"user ${_id.toString}"

  val name: String = firstName + " " + lastName

  val abreviatedName: String =
    (firstName.take(1) + lastName).toLowerCase.replace(" ", "_")

  def isAdminOf(_organization: ObjectId): Boolean =
    isAdmin && _organization == this._organization

  def isAdminOf(otherUser: User): Boolean =
    isAdminOf(otherUser._organization)

}

class UserDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[User, UsersRow, Users](sqlClient) {
  protected val collection = Users

  protected def idColumn(x: Users): Rep[String] = x._Id
  protected def isDeletedColumn(x: Users): Rep[Boolean] = x.isdeleted

  protected def parse(r: UsersRow): Fox[User] =
    for {
      userConfiguration <- parseAndValidateJson[JsObject](r.userconfiguration)
    } yield {
      User(
        ObjectId(r._Id),
        ObjectId(r._Multiuser),
        ObjectId(r._Organization),
        r.firstname,
        r.lastname,
        Instant.fromSql(r.lastactivity),
        userConfiguration,
        LoginInfo(User.default_login_provider_id, r._Id),
        r.isadmin,
        r.isorganizationowner,
        r.isdatasetmanager,
        r.isdeactivated,
        r.isunlisted,
        Instant.fromSql(r.created),
        r.lasttasktypeid.map(ObjectId(_)),
        r.isdeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""(_id in (select _user from webknossos.user_team_roles where _team in (select _team from webknossos.user_team_roles where _user = $requestingUserId and isTeamManager)))
        or (_organization in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin))
        or _id = $requestingUserId"""
  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"_organization in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin)"

  private def listAccessQ(requestingUserId: ObjectId) =
    q"""(${readAccessQ(requestingUserId)})
        and
        (
          isUnlisted = false
          or
          ($requestingUserId in
            (
              select u._id
              from webknossos.users_ u join webknossos.multiUsers_ m on u._multiUser = m._id
              where m.isSuperUser
            )
          )
        )"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where _id = $id and $accessQuery".as[UsersRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"select $columns from $existingCollectionName where $accessQuery".as[UsersRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByTeams(teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[User]] =
    if (teamIds.isEmpty) Fox.successful(List())
    else
      for {
        accessQuery <- accessQueryFromAccessQ(listAccessQ)
        r <- run(q"""select ${columnsWithPrefix("u.")}
                     from (select $columns from $existingCollectionName where $accessQuery) u join webknossos.user_team_roles on u._id = webknossos.user_team_roles._user
                     where webknossos.user_team_roles._team in ${SqlToken.tuple(teamIds)}
                     and not u.isDeactivated
                     order by _id""".as[UsersRow])
        parsed <- parseAll(r)
      } yield parsed

  def findAllByMultiUser(multiUserId: ObjectId): Fox[List[User]] =
    for {
      r <- run(q"""select $columns from $existingCollectionName where _multiUser = $multiUserId""".as[UsersRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAdminsAndDatasetManagersByOrg(organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"""select $columns
                   from $existingCollectionName
                   where $accessQuery
                   and (isDatasetManager or isAdmin)
                   and not isDeactivated
                   and _organization = $organizationId
                   order by _id""".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findOneByOrgaAndMultiUser(organizationId: ObjectId, multiUserId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      resultList <- run(q"""select $columns from $existingCollectionName
                            where _multiUser = $multiUserId and _organization = $organizationId
                            and $accessQuery
                            limit 1""".as[UsersRow])
      result <- resultList.headOption.toFox
      parsed <- parse(result)
    } yield parsed

  def findFirstByMultiUser(multiUserId: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      resultList <- run(q"""select $columns from $existingCollectionName
                            where _multiUser = $multiUserId and not isDeactivated and $accessQuery
                            limit 1""".as[UsersRow])
      result <- resultList.headOption.toFox
      parsed <- parse(result)
    } yield parsed

  def findContributorsForAnnotation(annotationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      result <- run(
        q"""select $columns from $existingCollectionName
              where _id in (select _user from webknossos.annotation_contributors where _annotation = $annotationId) and $accessQuery"""
          .as[UsersRow])
      parsed <- parseAll(result)
    } yield parsed

  def countAllForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        q"select count(_id) from $existingCollectionName where _organization = $organizationId and not isDeactivated and not isUnlisted"
          .as[Int])
      result <- resultList.headOption
    } yield result

  def countAdminsForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        q"select count(_id) from $existingCollectionName where _organization = $organizationId and isAdmin and not isUnlisted"
          .as[Int])
      result <- resultList.headOption
    } yield result

  def countIdentitiesForMultiUser(multiUserId: ObjectId): Fox[Int] =
    for {
      resultList <- run(q"select count(_id) from $existingCollectionName where _multiUser = $multiUserId".as[Int])
      result <- resultList.headOption
    } yield result

  def insertOne(u: User): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.users(
                               _id, _multiUser, _organization, firstName, lastName,
                               lastActivity, userConfiguration,
                               isDeactivated, isAdmin, isOrganizationOwner,
                               isDatasetManager, isUnlisted,
                               created, isDeleted
                             )
                             VALUES(
                               ${u._id}, ${u._multiUser}, ${u._organization}, ${u.firstName}, ${u.lastName},
                               ${u.lastActivity}, ${u.userConfiguration},
                               ${u.isDeactivated}, ${u.isAdmin}, ${u.isOrganizationOwner},
                               ${u.isDatasetManager}, ${u.isUnlisted},
                               ${u.created}, ${u.isDeleted}
                             )""".asUpdate)
    } yield ()

  def updateLastActivity(userId: ObjectId, lastActivity: Instant = Instant.now)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    updateTimestampCol(userId, _.lastactivity, lastActivity)

  def updateUserConfiguration(userId: ObjectId, userConfiguration: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q"""update webknossos.users
               set userConfiguration = $userConfiguration
               where _id = $userId""".asUpdate)
    } yield ()

  def updateValues(userId: ObjectId,
                   firstName: String,
                   lastName: String,
                   isAdmin: Boolean,
                   isDatasetManager: Boolean,
                   isDeactivated: Boolean,
                   lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val query = for { row <- Users if notdel(row) && idColumn(row) === userId.id } yield
      (row.firstname, row.lastname, row.isadmin, row.isdatasetmanager, row.isdeactivated, row.lasttasktypeid)
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(query.update(firstName, lastName, isAdmin, isDatasetManager, isDeactivated, lastTaskTypeId))
    } yield ()
  }

  def updateLastTaskTypeId(userId: ObjectId, lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q"""update webknossos.users
               set lasttasktypeid = $lastTaskTypeId
               where _id = $userId""".asUpdate)
    } yield ()

  // use with care!
  def deleteAllWithOrganization(organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""update webknossos.users set isDeleted = true where _organization = $organizationId""".asUpdate)
    } yield ()

  def findTeamMembershipsForUser(userId: ObjectId): Fox[List[TeamMembership]] = {
    val query = for {
      (teamRoleRow, team) <- UserTeamRoles.filter(_._User === userId.id) join Teams on (_._Team === _._Id)
    } yield (team._Id, team.name, teamRoleRow.isteammanager)

    for {
      rows: Seq[(String, String, Boolean)] <- run(query.result)
      teamMemberships <- Fox.combined(rows.toList.map {
        case (teamId, _, isTeamManager) =>
          ObjectId.fromString(teamId).map(teamIdValidated => TeamMembership(teamIdValidated, isTeamManager))
      })
    } yield teamMemberships
  }

  private def insertTeamMembershipQuery(userId: ObjectId, teamMembership: TeamMembership) =
    q"insert into webknossos.user_team_roles(_user, _team, isTeamManager) values($userId, ${teamMembership.teamId}, ${teamMembership.isTeamManager})".asUpdate

  def updateTeamMembershipsForUser(userId: ObjectId, teamMemberships: List[TeamMembership])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = q"delete from webknossos.user_team_roles where _user = $userId".asUpdate
    val insertQueries = teamMemberships.map(insertTeamMembershipQuery(userId, _))
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
    } yield ()
  }

  def insertTeamMembership(userId: ObjectId, teamMembership: TeamMembership)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(insertTeamMembershipQuery(userId, teamMembership))
    } yield ()

  def removeTeamFromAllUsers(teamId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"delete from webknossos.user_team_roles where _team = $teamId".asUpdate)
    } yield ()

  def findTeamMemberDifference(potentialSubteam: ObjectId, superteams: List[ObjectId]): Fox[List[User]] =
    for {
      r <- run(q"""select ${columnsWithPrefix("u.")} from $existingCollectionName u
                   join webknossos.user_team_roles tr on u._id = tr._user
                   where not u.isAdmin
                   and not u.isDeactivated
                   and tr._team = $potentialSubteam
                   and u._id not in
                   (select _user from webknossos.user_team_roles
                   where _team in ${SqlToken.tuple(superteams)})
                   """.as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

}

class UserExperiencesDAO @Inject()(sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllExperiencesForUser(userId: ObjectId): Fox[Map[String, Int]] =
    for {
      rows <- run(UserExperiences.filter(_._User === userId.id).result)
    } yield {
      rows.map(r => (r.domain, r.value)).toMap
    }

  def updateExperiencesForUser(user: User, experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = q"delete from webknossos.user_experiences where _user = ${user._id}".asUpdate
    val insertQueries = experiences.map {
      case (domain, value) =>
        q"insert into webknossos.user_experiences(_user, domain, value) values(${user._id}, $domain, $value)".asUpdate
    }
    for {
      _ <- userDAO.assertUpdateAccess(user._id)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
      _ <- Fox.serialCombined(experiences.keySet.toList)(domain =>
        insertExperienceToListing(domain, user._organization))
    } yield ()
  }

  def insertExperienceToListing(experienceDomain: String, organizationId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.experienceDomains(domain, _organization)
              values($experienceDomain, $organizationId) ON CONFLICT DO NOTHING""".asUpdate)
    } yield ()

}

class UserDataSetConfigurationDAO @Inject()(sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findOneForUserAndDataset(userId: ObjectId, dataSetId: ObjectId): Fox[DataSetViewConfiguration] =
    for {
      rows <- run(q"""select viewConfiguration
                      from webknossos.user_dataSetConfigurations
                      where _dataSet = $dataSetId
                      and _user = $userId""".as[String])
      parsed = rows.map(Json.parse)
      result <- parsed.headOption.map(_.validate[DataSetViewConfiguration].getOrElse(Map.empty)).toFox
    } yield result

  def updateDatasetConfigurationForUserAndDataset(
      userId: ObjectId,
      dataSetId: ObjectId,
      configuration: DataSetViewConfiguration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = q"""delete from webknossos.user_dataSetConfigurations
               where _user = $userId and _dataSet = $dataSetId""".asUpdate
      insertQuery = q"""insert into webknossos.user_dataSetConfigurations(_user, _dataSet, viewConfiguration)
               values($userId, $dataSetId, ${Json.toJson(configuration)})""".asUpdate
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}

class UserDataSetLayerConfigurationDAO @Inject()(sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllByLayerNameForUserAndDataset(layerNames: List[String],
                                          userId: ObjectId,
                                          dataSetId: ObjectId): Fox[Map[String, LayerViewConfiguration]] =
    for {
      rows <- run(q"""select layerName, viewConfiguration
                      from webknossos.user_dataSetLayerConfigurations
                      where _dataset = $dataSetId
                      and _user = $userId
                      and layerName in ${SqlToken.tuple(layerNames)}""".as[(String, String)])
      parsed = rows.flatMap(t => Json.parse(t._2).asOpt[LayerViewConfiguration].map((t._1, _)))
    } yield parsed.toMap

  def updateDatasetConfigurationForUserAndDatasetAndLayer(
      userId: ObjectId,
      dataSetId: ObjectId,
      layerName: String,
      viewConfiguration: LayerViewConfiguration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = q"""delete from webknossos.user_dataSetLayerConfigurations
               where _user = $userId and _dataSet = $dataSetId and layerName = $layerName""".asUpdate
      insertQuery = q"""insert into webknossos.user_dataSetLayerConfigurations(_user, _dataSet, layerName, viewConfiguration)
               values($userId, $dataSetId, $layerName, ${Json.toJson(viewConfiguration)})""".asUpdate
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}
