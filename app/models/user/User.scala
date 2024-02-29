package models.user

import play.silhouette.api.{Identity, LoginInfo}
import com.scalableminds.util.accesscontext._
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.JsonHelper.parseAndValidateJson
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.schema.Tables._

import javax.inject.Inject
import models.team._
import play.api.libs.json._
import slick.jdbc.GetResult
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}
import utils.ObjectId

import java.sql.Timestamp
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

  def toStringAnonymous: String = s"User ${_id}"

  val name: String = firstName + " " + lastName

  val abbreviatedName: String =
    (firstName.take(1) + lastName).toLowerCase.replace(" ", "_")

  def isAdminOf(_organization: ObjectId): Boolean =
    isAdmin && _organization == this._organization

  def isAdminOf(otherUser: User): Boolean =
    isAdminOf(otherUser._organization)

}

case class UserCompactInfo(
    _id: String,
    _multiUserId: String,
    email: String,
    firstname: String,
    lastname: String,
    userConfiguration: String,
    isAdmin: Boolean,
    isOrganizationOwner: Boolean,
    isDatasetManager: Boolean,
    isDeactivated: Boolean,
    teamIdsAsArrayLiteral: String,
    teamNamesAsArrayLiteral: String,
    teamManagersAsArrayLiteral: String,
    experienceValuesAsArrayLiteral: String,
    experienceDomainsAsArrayLiteral: String,
    lastActivity: Timestamp,
    organization_id: String,
    organization_name: String,
    novelUserExperienceInfos: String,
    selectedTheme: String,
    created: Timestamp,
    lastTaskTypeId: Option[String],
    isSuperUser: Boolean,
    isEmailVerified: Boolean,
    isEditable: Boolean
) {
  def toUser(implicit ec: ExecutionContext): Fox[User] =
    for {
      userConfiguration <- Fox.box2Fox(parseAndValidateJson[JsObject](userConfiguration))
    } yield {
      User(
        ObjectId(_id),
        ObjectId(_multiUserId),
        ObjectId(organization_id),
        firstname,
        lastname,
        Instant.fromSql(lastActivity),
        userConfiguration,
        LoginInfo(User.default_login_provider_id, _id),
        isAdmin,
        isOrganizationOwner,
        isDatasetManager,
        isDeactivated,
        isUnlisted = false,
        Instant.fromSql(created),
        lastTaskTypeId.map(ObjectId(_))
      )
    }
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
    readAccessQWithPrefix(requestingUserId, SqlToken.raw(""))

  protected def readAccessQWithPrefix(requestingUserId: ObjectId, userPrefix: SqlToken) =
    q"""(${userPrefix}_id in (select _user from webknossos.user_team_roles where _team in (select _team from webknossos.user_team_roles where _user = $requestingUserId and isTeamManager)))
        or (${userPrefix}_organization in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin))
        or ${userPrefix}_id = $requestingUserId"""
  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"_organization in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin)"

  private def listAccessQ(requestingUserId: ObjectId) = listAccessQWithPrefix(requestingUserId, SqlToken.raw(""))
  private def listAccessQWithPrefix(requestingUserId: ObjectId, prefix: SqlToken) =
    q"""(${readAccessQWithPrefix(requestingUserId, prefix)})
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

  def buildSelectionPredicates(isEditableOpt: Option[Boolean],
                               isTeamManagerOrAdminOpt: Option[Boolean],
                               isAdminOpt: Option[Boolean],
                               requestingUser: User,
                               userPrefix: SqlToken)(implicit ctx: DBAccessContext): Fox[SqlToken] =
    for {
      accessQuery <- accessQueryFromAccessQWithPrefix(listAccessQWithPrefix, userPrefix)
      editablePredicate = isEditableOpt match {
        case Some(isEditable) =>
          val usersInTeamsManagedByRequestingUser =
            q"(SELECT _user FROM webknossos.user_team_roles WHERE _team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = ${requestingUser._id}  AND isTeamManager)))"
          if (isEditable) {
            q"(${userPrefix}_id IN $usersInTeamsManagedByRequestingUser OR (${requestingUser.isAdmin} AND ${userPrefix}_organization = ${requestingUser._organization})"
          } else {
            q"(${userPrefix}_id NOT IN $usersInTeamsManagedByRequestingUser AND (NOT (${requestingUser.isAdmin} AND ${userPrefix}_organization = ${requestingUser._organization}))"
          }
        case None => q"${true}"
      }
      isTeamManagerOrAdminPredicate = isTeamManagerOrAdminOpt match {
        case Some(isTeamManagerOrAdmin) =>
          val teamManagers = q"(SELECT _user FROM webknossos.user_team_roles WHERE isTeamManager)"
          if (isTeamManagerOrAdmin) {
            q"${userPrefix}_id IN $teamManagers OR ${userPrefix}isAdmin"
          } else {
            q"${userPrefix}_id NOT IN $teamManagers AND NOT ${userPrefix}isAdmin"
          }
        case None => q"${true}"
      }
      adminPredicate = isAdminOpt.map(isAdmin => q"${userPrefix}isAdmin = $isAdmin").getOrElse(q"${true}")
    } yield q"""
        ($editablePredicate) AND
        ($isTeamManagerOrAdminPredicate) AND
        ($adminPredicate) AND
        $accessQuery
       """

  // Necessary since a tuple can only have 22 elements
  implicit def GetResultUserCompactInfo(implicit e0: GetResult[String],
                                        e1: GetResult[java.sql.Timestamp],
                                        e2: GetResult[Boolean],
                                        e3: GetResult[Option[String]]): GetResult[UserCompactInfo] = GetResult { prs =>
    import prs._
    // format: off
    UserCompactInfo(<<[String],<<[String],<<[String],<<[String],<<[String],<<[String],<<[Boolean],<<[Boolean],
      <<[Boolean],<<[Boolean],<<[String],<<[String],<<[String],<<[String], <<[String],<<[java.sql.Timestamp],<<[String],
      <<[String],<<[String],<<[String],<<[java.sql.Timestamp],<<?[String],<<[Boolean],<<[Boolean],<<[Boolean]
    )
    // format: on
  }
  def findAllCompactWithFilters(
      isEditable: Option[Boolean],
      isTeamManagerOrAdmin: Option[Boolean],
      isAdmin: Option[Boolean],
      requestingUser: User)(implicit ctx: DBAccessContext): Fox[(List[User], List[UserCompactInfo])] =
    for {
      selectionPredicates <- buildSelectionPredicates(isEditable,
                                                      isTeamManagerOrAdmin,
                                                      isAdmin,
                                                      requestingUser,
                                                      SqlToken.raw("u."))
      isEditableAttribute = q"""
        (u._id IN
          (SELECT _id AS editableUsers FROM webknossos.users WHERE _organization IN
              (SELECT _organization FROM webknossos.users WHERE _id = ${requestingUser._id} AND isAdmin)
            UNION
          SELECT _user AS editableUsers FROM webknossos.user_team_roles WHERE _team in
              (SELECT _team FROM webknossos.user_team_roles WHERE _user = ${requestingUser._id} AND isTeamManager)
          )
        )
        OR COUNT(autr.team_ids) = 0
        AS iseditable
        """
      r <- run(q"""
          WITH
          agg_experiences AS (
            SELECT
              u._id AS _user,
              ARRAY_REMOVE(ARRAY_AGG(ux.domain), null) AS experience_domains,
              ARRAY_REMOVE(ARRAY_AGG(ux.value), null) AS experience_values
            FROM webknossos.users AS u
            LEFT JOIN webknossos.user_experiences ux on ux._user = u._id
            GROUP BY u._id
          ),
          agg_user_team_roles AS (
            SELECT
              u._id AS _user,
              ARRAY_REMOVE(ARRAY_AGG(t._id), null) AS team_ids,
              ARRAY_REMOVE(ARRAY_AGG(t.name), null) AS team_names,
              ARRAY_REMOVE(ARRAY_AGG(utr.isteammanager :: TEXT), null) AS team_managers
            FROM webknossos.users AS u
            LEFT JOIN webknossos.user_team_roles utr on utr._user = u._id
            INNER JOIN webknossos.teams t on t._id = utr._team
            GROUP BY u._id
          )
          SELECT
            u._id,
            m._id,
            m.email,
            u.firstName,
            u.lastName,
            u.userConfiguration,
            u.isAdmin,
            u.isOrganizationOwner,
            u.isDatasetManager,
            u.isDeactivated,
            autr.team_ids,
            autr.team_names,
            autr.team_managers,
            aux.experience_values,
            aux.experience_domains,
            u.lastActivity,
            o._id,
            o.name,
            m.novelUserExperienceinfos,
            m.selectedTheme,
            u.created,
            u.lastTaskTypeId,
            m.isSuperUser,
            m.isEmailVerified,
            $isEditableAttribute
        FROM webknossos.users AS u
        INNER JOIN webknossos.organizations o on o._id = u._organization
        INNER JOIN webknossos.multiusers m on u._multiuser = m._id
        INNER JOIN agg_user_team_roles autr on autr._user = u._id
        INNER JOIN agg_experiences aux on aux._user = u._id
        WHERE $selectionPredicates
        GROUP BY
          u._id, u.firstname, u.lastname, u.userConfiguration, u.isAdmin, u.isOrganizationOwner, u.isDatasetManager,
          u.isDeactivated, u.lastActivity, u.created, u.lastTaskTypeId, o._id,
          m._id, m.email, m.novelUserExperienceinfos, m.selectedTheme, m.isSuperUser, m.isEmailVerified,
          autr.team_ids, autr.team_names, autr.team_managers, aux.experience_values, aux.experience_domains
         """.as[UserCompactInfo])
      users <- Fox.combined(r.toList.map(_.toUser))
      compactInfos = r.toList
    } yield (users, compactInfos)

  def findAllByTeams(teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[User]] =
    if (teamIds.isEmpty) Fox.successful(List())
    else
      for {
        accessQuery <- accessQueryFromAccessQ(listAccessQ)
        r <- run(q"""select ${columnsWithPrefix("u.")}
                     from (select $columns from $existingCollectionName where $accessQuery) u join webknossos.user_team_roles on u._id = webknossos.user_team_roles._user
                     where webknossos.user_team_roles._team in ${SqlToken.tupleFromList(teamIds)}
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

  def findOwnerByOrg(organizationId: ObjectId): Fox[User] =
    for {
      r <- run(q"""select $columns
                   from $existingCollectionName
                   where isOrganizationOwner
                   and not isDeactivated
                   and _organization = $organizationId
                   order by _id
                   limit 1""".as[UsersRow])
      parsed <- parseFirst(r, organizationId)
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
      result <- run(q"""SELECT $columns
                        FROM $existingCollectionName
                        WHERE _id IN
                          (SELECT _user FROM webknossos.annotation_contributors WHERE _annotation = $annotationId)
                        AND NOT isUnlisted
                        AND $accessQuery""".as[UsersRow])
      parsed <- parseAll(result)
    } yield parsed

  def countAllForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        q"select count(*) from $existingCollectionName where _organization = $organizationId and not isDeactivated and not isUnlisted"
          .as[Int])
      result <- resultList.headOption
    } yield result

  def countAdminsForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        q"select count(*) from $existingCollectionName where _organization = $organizationId and isAdmin and not isUnlisted"
          .as[Int])
      result <- resultList.headOption
    } yield result

  def countOwnersForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        q"select count(*) from $existingCollectionName where _organization = $organizationId and isOrganizationOwner and not isUnlisted"
          .as[Int])
      result <- resultList.headOption
    } yield result

  def countIdentitiesForMultiUser(multiUserId: ObjectId): Fox[Int] =
    for {
      resultList <- run(q"select count(*) from $existingCollectionName where _multiUser = $multiUserId".as[Int])
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
                   where _team in ${SqlToken.tupleFromList(superteams)})
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

class UserDatasetConfigurationDAO @Inject()(sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findOneForUserAndDataset(userId: ObjectId, datasetId: ObjectId): Fox[DatasetViewConfiguration] =
    for {
      rows <- run(q"""select viewConfiguration
                      from webknossos.user_datasetConfigurations
                      where _dataset = $datasetId
                      and _user = $userId""".as[String])
      parsed = rows.map(Json.parse)
      result <- parsed.headOption.map(_.validate[DatasetViewConfiguration].getOrElse(Map.empty)).toFox
    } yield result

  def updateDatasetConfigurationForUserAndDataset(
      userId: ObjectId,
      datasetId: ObjectId,
      configuration: DatasetViewConfiguration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = q"""delete from webknossos.user_datasetConfigurations
               where _user = $userId and _dataset = $datasetId""".asUpdate
      insertQuery = q"""insert into webknossos.user_datasetConfigurations(_user, _dataset, viewConfiguration)
               values($userId, $datasetId, ${Json.toJson(configuration)})""".asUpdate
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}

class UserDatasetLayerConfigurationDAO @Inject()(sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllByLayerNameForUserAndDataset(layerNames: List[String],
                                          userId: ObjectId,
                                          datasetId: ObjectId): Fox[Map[String, LayerViewConfiguration]] =
    if (layerNames.isEmpty) {
      Fox.successful(Map.empty[String, LayerViewConfiguration])
    } else {
      for {
        rows <- run(q"""select layerName, viewConfiguration
                      from webknossos.user_datasetLayerConfigurations
                      where _dataset = $datasetId
                      and _user = $userId
                      and layerName in ${SqlToken.tupleFromList(layerNames)}""".as[(String, String)])
        parsed = rows.flatMap(t => Json.parse(t._2).asOpt[LayerViewConfiguration].map((t._1, _)))
      } yield parsed.toMap
    }

  def updateDatasetConfigurationForUserAndDatasetAndLayer(
      userId: ObjectId,
      datasetId: ObjectId,
      layerName: String,
      viewConfiguration: LayerViewConfiguration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = q"""delete from webknossos.user_datasetLayerConfigurations
               where _user = $userId and _dataset = $datasetId and layerName = $layerName""".asUpdate
      insertQuery = q"""insert into webknossos.user_datasetLayerConfigurations(_user, _dataset, layerName, viewConfiguration)
               values($userId, $datasetId, $layerName, ${Json.toJson(viewConfiguration)})""".asUpdate
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}
