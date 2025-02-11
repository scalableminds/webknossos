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
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

object User {
  val default_login_provider_id: String = "credentials"
}

case class User(
    _id: ObjectId,
    _multiUser: ObjectId,
    _organization: String,
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

  def isAdminOf(organizationId: String): Boolean =
    isAdmin && organizationId == this._organization

  def isAdminOf(otherUser: User): Boolean =
    isAdminOf(otherUser._organization)

}

case class UserCompactInfo(
    _id: ObjectId,
    _multiUserId: ObjectId,
    email: String,
    firstName: String,
    lastName: String,
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
    lastActivity: Instant,
    organizationId: String,
    novelUserExperienceInfos: String,
    selectedTheme: String,
    created: Instant,
    lastTaskTypeId: Option[String],
    isSuperUser: Boolean,
    isEmailVerified: Boolean,
    isEditable: Boolean
)

class UserDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[User, UsersRow, Users](sqlClient) {

  protected val collection = Users
  protected def idColumn(x: Users): Rep[String] = x._Id
  protected def isDeletedColumn(x: Users): Rep[Boolean] = x.isdeleted
  protected def getResult = GetResultUsersRow

  protected def parse(r: UsersRow): Fox[User] =
    for {
      userConfiguration <- parseAndValidateJson[JsObject](r.userconfiguration)
    } yield User(
      ObjectId(r._Id),
      ObjectId(r._Multiuser),
      r._Organization,
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

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    readAccessQWithPrefix(requestingUserId, SqlToken.raw(""))

  protected def readAccessQWithPrefix(requestingUserId: ObjectId, userPrefix: SqlToken): SqlToken =
    q"""(${userPrefix}_id IN (SELECT _user FROM webknossos.user_team_roles WHERE _team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId AND isTeamManager)))
        OR (${userPrefix}_organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin))
        OR ${userPrefix}_id = $requestingUserId"""
  override protected def deleteAccessQ(requestingUserId: ObjectId): SqlToken =
    q"_organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)"

  private def listAccessQ(requestingUserId: ObjectId) = listAccessQWithPrefix(requestingUserId, SqlToken.raw(""))
  private def listAccessQWithPrefix(requestingUserId: ObjectId, prefix: SqlToken) =
    q"""(${readAccessQWithPrefix(requestingUserId, prefix)})
        AND
        (
          NOT isUnlisted
          OR
          ($requestingUserId IN
            (
              SELECT u._id
              FROM webknossos.users_ u
              JOIN webknossos.multiUsers_ m ON u._multiUser = m._id
              WHERE m.isSuperUser
            )
          )
        )"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[UsersRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[UsersRow])
      parsed <- parseAll(r)
    } yield parsed

  def buildSelectionPredicates(
      isEditableOpt: Option[Boolean],
      isTeamManagerOrAdminOpt: Option[Boolean],
      isAdminOpt: Option[Boolean],
      requestingUser: User,
      userPrefix: SqlToken
  )(implicit ctx: DBAccessContext): Fox[SqlToken] =
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
        case None => q"TRUE"
      }
      isTeamManagerOrAdminPredicate = isTeamManagerOrAdminOpt match {
        case Some(isTeamManagerOrAdmin) =>
          val teamManagers = q"(SELECT _user FROM webknossos.user_team_roles WHERE isTeamManager)"
          if (isTeamManagerOrAdmin) {
            q"${userPrefix}_id IN $teamManagers OR ${userPrefix}isAdmin"
          } else {
            q"${userPrefix}_id NOT IN $teamManagers AND NOT ${userPrefix}isAdmin"
          }
        case None => q"TRUE"
      }
      adminPredicate = isAdminOpt.map(isAdmin => q"${userPrefix}isAdmin = $isAdmin").getOrElse(q"TRUE")
    } yield q"""
        ($editablePredicate) AND
        ($isTeamManagerOrAdminPredicate) AND
        ($adminPredicate) AND
        $accessQuery
       """

  // Necessary since a tuple can only have 22 elements
  implicit def GetResultUserCompactInfo: GetResult[UserCompactInfo] = GetResult { prs =>
    import prs._
    // format: off
    UserCompactInfo(<<[ObjectId],<<[ObjectId],<<[String],<<[String],<<[String],<<[String],<<[Boolean],<<[Boolean],
      <<[Boolean],<<[Boolean],<<[String],<<[String],<<[String],<<[String], <<[String],<<[Instant],
      <<[String],<<[String],<<[String],<<[Instant],<<?[String],<<[Boolean],<<[Boolean],<<[Boolean]
    )
    // format: on
  }

  def findAllCompactWithFilters(
      isEditable: Option[Boolean],
      isTeamManagerOrAdmin: Option[Boolean],
      isAdmin: Option[Boolean],
      requestingUser: User
  )(implicit ctx: DBAccessContext): Fox[List[UserCompactInfo]] =
    for {
      selectionPredicates <- buildSelectionPredicates(
        isEditable,
        isTeamManagerOrAdmin,
        isAdmin,
        requestingUser,
        SqlToken.raw("u.")
      )
      isEditableAttribute = q"""
        (u._id IN
          (SELECT _id AS editableUsers FROM webknossos.users WHERE _organization IN
              (SELECT _organization FROM webknossos.users WHERE _id = ${requestingUser._id} AND isAdmin)
            UNION
          SELECT _user AS editableUsers FROM webknossos.user_team_roles WHERE _team IN
              (SELECT _team FROM webknossos.user_team_roles WHERE _user = ${requestingUser._id} AND isTeamManager)
          )
        )
        OR COUNT(autr.team_ids) = 0
        AS iseditable
        """
      rows <- run(q"""
          WITH
          -- agg_experiences and agg_user_team_roles are extracted to avoid left-join fanout.
          agg_experiences AS (
            SELECT
              u._id AS _user,
              ARRAY_REMOVE(ARRAY_AGG(ux.domain), null) AS experience_domains,
              ARRAY_REMOVE(ARRAY_AGG(ux.value), null) AS experience_values
            FROM webknossos.users AS u
            LEFT JOIN webknossos.user_experiences ux ON ux._user = u._id
            GROUP BY u._id
          ),
          agg_user_team_roles AS (
            SELECT
              u._id AS _user,
              ARRAY_REMOVE(ARRAY_AGG(t._id), null) AS team_ids,
              ARRAY_REMOVE(ARRAY_AGG(t.name), null) AS team_names,
              ARRAY_REMOVE(ARRAY_AGG(utr.isTeamManager :: TEXT), null) AS team_managers
            FROM webknossos.users AS u
            LEFT JOIN webknossos.user_team_roles utr ON utr._user = u._id
            LEFT JOIN webknossos.teams t ON t._id = utr._team -- should not cause fanout since there is only one team per team_role
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
            m.novelUserExperienceinfos,
            m.selectedTheme,
            u.created,
            u.lastTaskTypeId,
            m.isSuperUser,
            m.isEmailVerified,
            $isEditableAttribute
        FROM webknossos.users AS u
        INNER JOIN webknossos.organizations o ON o._id = u._organization
        INNER JOIN webknossos.multiusers m ON u._multiuser = m._id
        INNER JOIN agg_user_team_roles autr ON autr._user = u._id
        INNER JOIN agg_experiences aux ON aux._user = u._id
        WHERE $selectionPredicates
        GROUP BY
          u._id, u.firstname, u.lastname, u.userConfiguration, u.isAdmin, u.isOrganizationOwner, u.isDatasetManager,
          u.isDeactivated, u.lastActivity, u.created, u.lastTaskTypeId, o._id,
          m._id, m.email, m.novelUserExperienceinfos, m.selectedTheme, m.isSuperUser, m.isEmailVerified,
          autr.team_ids, autr.team_names, autr.team_managers, aux.experience_values, aux.experience_domains
         """.as[UserCompactInfo])
    } yield rows.toList

  // NOTE: This will not return admins. They have “access to all teams”. Consider fetching those too when you use this
  def findAllByTeams(teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[User]] =
    if (teamIds.isEmpty) Fox.successful(List())
    else
      for {
        accessQuery <- accessQueryFromAccessQ(listAccessQ)
        r <- run(q"""SELECT ${columnsWithPrefix("u.")}
                     FROM
                     (SELECT $columns FROM $existingCollectionName WHERE $accessQuery) u
                     JOIN webknossos.user_team_roles ON u._id = webknossos.user_team_roles._user
                     WHERE webknossos.user_team_roles._team IN ${SqlToken.tupleFromList(teamIds)}
                     AND NOT u.isDeactivated
                     ORDER BY _id""".as[UsersRow])
        parsed <- parseAll(r)
      } yield parsed

  def findAllByMultiUser(multiUserId: ObjectId): Fox[List[User]] =
    for {
      r <- run(q"""SELECT $columns FROM $existingCollectionName WHERE _multiUser = $multiUserId""".as[UsersRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAdminsAndDatasetManagersByOrg(organizationId: String)(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE $accessQuery
                   AND (isDatasetManager OR isAdmin)
                   AND NOT isDeactivated
                   AND _organization = $organizationId
                   ORDER BY _id""".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAdminsByOrg(organizationId: String)(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE $accessQuery
                   AND isAdmin
                   AND NOT isDeactivated
                   AND _organization = $organizationId
                   ORDER BY _id""".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findOwnerByOrg(organizationId: String): Fox[User] =
    for {
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE isOrganizationOwner
                   AND NOT isDeactivated
                   AND _organization = $organizationId
                   ORDER BY _id
                   LIMIT 1""".as[UsersRow])
      parsed <- parseFirst(r, organizationId)
    } yield parsed

  def findOneByOrgaAndMultiUser(organizationId: String, multiUserId: ObjectId)(implicit
      ctx: DBAccessContext
  ): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      resultList <- run(q"""SELECT $columns
                            FROM $existingCollectionName
                            WHERE _multiUser = $multiUserId
                            AND _organization = $organizationId
                            AND $accessQuery
                            LIMIT 1""".as[UsersRow])
      result <- resultList.headOption.toFox
      parsed <- parse(result)
    } yield parsed

  def findFirstByMultiUser(multiUserId: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      resultList <- run(q"""SELECT $columns
                            FROM $existingCollectionName
                            WHERE _multiUser = $multiUserId
                            AND NOT isDeactivated
                            AND $accessQuery
                            LIMIT 1""".as[UsersRow])
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

  def countAllForOrganization(organizationId: String): Fox[Int] =
    for {
      resultList <- run(
        q"SELECT COUNT(*) FROM $existingCollectionName WHERE _organization = $organizationId AND NOT isDeactivated AND NOT isUnlisted"
          .as[Int]
      )
      result <- resultList.headOption
    } yield result

  def countAdminsForOrganization(organizationId: String): Fox[Int] =
    for {
      resultList <- run(
        q"SELECT COUNT(*) from $existingCollectionName WHERE _organization = $organizationId AND isAdmin AND NOT isUnlisted"
          .as[Int]
      )
      result <- resultList.headOption
    } yield result

  def countOwnersForOrganization(organizationId: String): Fox[Int] =
    for {
      resultList <- run(
        q"SELECT COUNT(*) FROM $existingCollectionName WHERE _organization = $organizationId AND isOrganizationOwner AND NOT isUnlisted"
          .as[Int]
      )
      result <- resultList.headOption
    } yield result

  def countIdentitiesForMultiUser(multiUserId: ObjectId): Fox[Int] =
    for {
      resultList <- run(q"SELECT COUNT(*) FROM $existingCollectionName WHERE _multiUser = $multiUserId".as[Int])
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

  def updateLastActivity(userId: ObjectId, lastActivity: Instant = Instant.now)(implicit
      ctx: DBAccessContext
  ): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q"UPDATE webknossos.users SET lastActivity = $lastActivity WHERE _id = $userId".asUpdate)
    } yield ()

  def updateUserConfiguration(userId: ObjectId, userConfiguration: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q"""UPDATE webknossos.users
               SET userConfiguration = $userConfiguration
               WHERE _id = $userId""".asUpdate)
    } yield ()

  def updateValues(
      userId: ObjectId,
      firstName: String,
      lastName: String,
      isAdmin: Boolean,
      isDatasetManager: Boolean,
      isDeactivated: Boolean,
      lastTaskTypeId: Option[String]
  )(implicit ctx: DBAccessContext): Fox[Unit] = {
    val query =
      for { row <- Users if notdel(row) && idColumn(row) === userId.id } yield (
        row.firstname,
        row.lastname,
        row.isadmin,
        row.isdatasetmanager,
        row.isdeactivated,
        row.lasttasktypeid
      )
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(query.update(firstName, lastName, isAdmin, isDatasetManager, isDeactivated, lastTaskTypeId))
    } yield ()
  }

  def updateLastTaskTypeId(userId: ObjectId, lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q"""UPDATE webknossos.users
                   SET lasttasktypeid = $lastTaskTypeId
                   WHERE _id = $userId""".asUpdate)
    } yield ()

  // use with care!
  def deleteAllWithOrganization(organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.users SET isDeleted = true WHERE _organization = $organizationId""".asUpdate)
    } yield ()

  def findTeamMembershipsForUser(userId: ObjectId): Fox[List[TeamMembership]] = {
    val query = for {
      (teamRoleRow, team) <- UserTeamRoles.filter(_._User === userId.id) join Teams on (_._Team === _._Id)
    } yield (team._Id, team.name, teamRoleRow.isteammanager)

    for {
      rows: Seq[(String, String, Boolean)] <- run(query.result)
      teamMemberships <- Fox.combined(rows.toList.map { case (teamId, _, isTeamManager) =>
        ObjectId.fromString(teamId).map(teamIdValidated => TeamMembership(teamIdValidated, isTeamManager))
      })
    } yield teamMemberships
  }

  private def insertTeamMembershipQuery(userId: ObjectId, teamMembership: TeamMembership) =
    q"INSERT INTO webknossos.user_team_roles(_user, _team, isTeamManager) VALUES($userId, ${teamMembership.teamId}, ${teamMembership.isTeamManager})".asUpdate

  def updateTeamMembershipsForUser(userId: ObjectId, teamMemberships: List[TeamMembership])(implicit
      ctx: DBAccessContext
  ): Fox[Unit] = {
    val clearQuery = q"DELETE FROM webknossos.user_team_roles WHERE _user = $userId".asUpdate
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
      _ <- run(q"DELETE FROM webknossos.user_team_roles WHERE _team = $teamId".asUpdate)
    } yield ()

  def findTeamMemberDifference(potentialSubteam: ObjectId, superteams: List[ObjectId]): Fox[List[User]] =
    for {
      r <- run(q"""SELECT ${columnsWithPrefix("u.")}
                   FROM $existingCollectionName u
                   JOIN webknossos.user_team_roles tr ON u._id = tr._user
                   WHERE NOT u.isAdmin
                   AND NOT u.isDeactivated
                   AND tr._team = $potentialSubteam
                   AND u._id NOT in
                   (SELECT _user FROM webknossos.user_team_roles
                   WHERE _team IN ${SqlToken.tupleFromList(superteams)})
                   """.as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

}

class UserExperiencesDAO @Inject() (sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllExperiencesForUser(userId: ObjectId): Fox[Map[String, Int]] =
    for {
      rows <- run(UserExperiences.filter(_._User === userId.id).result)
    } yield rows.map(r => (r.domain, r.value)).toMap

  def updateExperiencesForUser(user: User, experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = q"DELETE FROM webknossos.user_experiences WHERE _user = ${user._id}".asUpdate
    val insertQueries = experiences.map { case (domain, value) =>
      q"INSERT INTO webknossos.user_experiences(_user, domain, value) VALUES(${user._id}, $domain, $value)".asUpdate
    }
    for {
      _ <- userDAO.assertUpdateAccess(user._id)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
      _ <- Fox.serialCombined(experiences.keySet.toList)(domain =>
        insertExperienceToListing(domain, user._organization)
      )
    } yield ()
  }

  def insertExperienceToListing(experienceDomain: String, organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.experienceDomains(domain, _organization)
              VALUES($experienceDomain, $organizationId) ON CONFLICT DO NOTHING""".asUpdate)
    } yield ()

}

class UserDatasetConfigurationDAO @Inject() (sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findOneForUserAndDataset(userId: ObjectId, datasetId: ObjectId): Fox[DatasetViewConfiguration] =
    for {
      rows <- run(q"""SELECT viewConfiguration
                      FROM webknossos.user_datasetConfigurations
                      WHERE _dataset = $datasetId
                      AND _user = $userId""".as[String])
      parsed = rows.map(Json.parse)
      result <- parsed.headOption.map(_.validate[DatasetViewConfiguration].getOrElse(Map.empty)).toFox
    } yield result

  def updateDatasetConfigurationForUserAndDataset(
      userId: ObjectId,
      datasetId: ObjectId,
      configuration: DatasetViewConfiguration
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = q"""DELETE FROM webknossos.user_datasetConfigurations
                        WHERE _user = $userId
                        AND _dataset = $datasetId""".asUpdate
      insertQuery = q"""INSERT INTO webknossos.user_datasetConfigurations(_user, _dataset, viewConfiguration)
                        VALUES($userId, $datasetId, ${Json.toJson(configuration)})""".asUpdate
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}

class UserDatasetLayerConfigurationDAO @Inject() (sqlClient: SqlClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllByLayerNameForUserAndDataset(
      layerNames: List[String],
      userId: ObjectId,
      datasetId: ObjectId
  ): Fox[Map[String, LayerViewConfiguration]] =
    if (layerNames.isEmpty) {
      Fox.successful(Map.empty[String, LayerViewConfiguration])
    } else {
      for {
        rows <- run(q"""SELECT layerName, viewConfiguration
                        FROM webknossos.user_datasetLayerConfigurations
                        WHERE _dataset = $datasetId
                        AND _user = $userId
                        AND layerName in ${SqlToken.tupleFromList(layerNames)}""".as[(String, String)])
        parsed = rows.flatMap(t => Json.parse(t._2).asOpt[LayerViewConfiguration].map((t._1, _)))
      } yield parsed.toMap
    }

  def updateDatasetConfigurationForUserAndDatasetAndLayer(
      userId: ObjectId,
      datasetId: ObjectId,
      layerName: String,
      viewConfiguration: LayerViewConfiguration
  )(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = q"""DELETE FROM webknossos.user_datasetLayerConfigurations
                        WHERE _user = $userId
                        AND _dataset = $datasetId
                        AND layerName = $layerName""".asUpdate
      insertQuery =
        q"""INSERT INTO webknossos.user_datasetLayerConfigurations(_user, _dataset, layerName, viewConfiguration)
                        VALUES($userId, $datasetId, $layerName, ${Json.toJson(viewConfiguration)})""".asUpdate
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}
