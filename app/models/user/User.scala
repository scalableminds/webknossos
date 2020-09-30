package models.user

import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.api.{AuthInfo, Identity, LoginInfo}
import com.scalableminds.util.accesscontext._
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import models.binary.DataSetDAO
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, SimpleSQLDAO}

import scala.concurrent.ExecutionContext

case class User(
    _id: ObjectId,
    _organization: ObjectId,
    email: String,
    firstName: String,
    lastName: String,
    lastActivity: Long = System.currentTimeMillis(),
    userConfiguration: JsValue,
    loginInfo: LoginInfo,
    passwordInfo: PasswordInfo,
    isAdmin: Boolean,
    isDatasetManager: Boolean,
    isSuperUser: Boolean,
    isDeactivated: Boolean,
    created: Long = System.currentTimeMillis(),
    lastTaskTypeId: Option[ObjectId] = None,
    isDeleted: Boolean = false
) extends DBAccessContextPayload
    with Identity
    with FoxImplicits {

  def toStringAnonymous: String = s"user ${_id.toString}"

  val name: String = firstName + " " + lastName

  val abreviatedName: String =
    (firstName.take(1) + lastName).toLowerCase.replace(" ", "_")

  def userConfigurationStructured: Fox[UserConfiguration] =
    JsonHelper.jsResultToFox(userConfiguration.validate[Map[String, JsValue]]).map(UserConfiguration(_))

  def isAdminOf(_organization: ObjectId): Boolean =
    isAdmin && _organization == this._organization

  def isAdminOf(otherUser: User): Boolean =
    isAdminOf(otherUser._organization)

}

class UserDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[User, UsersRow, Users](sqlClient) {
  val collection = Users

  def idColumn(x: Users): Rep[String] = x._Id
  def isDeletedColumn(x: Users): Rep[Boolean] = x.isdeleted

  def parse(r: UsersRow): Fox[User] =
    Fox.successful(
      User(
        ObjectId(r._Id),
        ObjectId(r._Organization),
        r.email,
        r.firstname,
        r.lastname,
        r.lastactivity.getTime,
        Json.parse(r.userconfiguration),
        LoginInfo(r.logininfoProviderid, r.logininfoProviderkey),
        PasswordInfo(r.passwordinfoHasher, r.passwordinfoPassword),
        r.isadmin,
        r.isdatasetmanager,
        r.issuperuser,
        r.isdeactivated,
        r.created.getTime,
        r.lasttasktypeid.map(ObjectId(_)),
        r.isdeleted
      ))

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""(_id in (select _user from webknossos.user_team_roles where _team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId}' and isTeamManager)))
        or (_organization in (select _organization from webknossos.users_ where _id = '${requestingUserId}' and isAdmin))
        or _id = '${requestingUserId}'"""
  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"_organization in (select _organization from webknossos.users_ where _id = '${requestingUserId}' and isAdmin)"

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where _id = ${id} and #${accessQuery}".as[UsersRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery}".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where email = ${email} and #${accessQuery}".as[UsersRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findAllByTeams(teams: List[ObjectId], includeDeactivated: Boolean = true)(implicit ctx: DBAccessContext) =
    if (teams.isEmpty) Fox.successful(List())
    else
      for {
        accessQuery <- readAccessQuery
        r <- run(sql"""select u.*
                         from (select #${columns} from #${existingCollectionName} where #${accessQuery}) u join webknossos.user_team_roles on u._id = webknossos.user_team_roles._user
                         where webknossos.user_team_roles._team in #${writeStructTupleWithQuotes(teams.map(_.id))}
                               and (u.isDeactivated = false or u.isDeactivated = ${includeDeactivated})
                         order by _id""".as[UsersRow])
        parsed <- Fox.combined(r.toList.map(parse))
      } yield parsed

  def findAllByIds(ids: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[User]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where _id in #${writeStructTupleWithQuotes(
        ids.map(_.id))} and #${accessQuery}".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def countAllForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        sql"select count(_id) from #${existingCollectionName} where _organization = ${organizationId}".as[Int])
      result <- resultList.headOption
    } yield result

  def countAdminsForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      resultList <- run(
        sql"select count(_id) from #${existingCollectionName} where _organization = ${organizationId} and isAdmin"
          .as[Int])
      result <- resultList.headOption
    } yield result

  def insertOne(u: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.users(_id, _organization, email, firstName, lastName, lastActivity, userConfiguration, loginInfo_providerID,
                     loginInfo_providerKey, passwordInfo_hasher, passwordInfo_password, isDeactivated, isAdmin, isDatasetManager, isSuperUser, created, isDeleted)
                     values(${u._id}, ${u._organization}, ${u.email}, ${u.firstName}, ${u.lastName}, ${new java.sql.Timestamp(
          u.lastActivity)},
                     '#${sanitize(Json.toJson(u.userConfiguration).toString)}', '#${sanitize(u.loginInfo.providerID)}', ${u.loginInfo.providerKey},
                     '#${sanitize(u.passwordInfo.hasher)}', ${u.passwordInfo.password}, ${u.isDeactivated}, ${u.isAdmin}, ${u.isDatasetManager}, ${u.isSuperUser},
                     ${new java.sql.Timestamp(u.created)}, ${u.isDeleted})
          """)
    } yield ()

  def updateLastActivity(userId: ObjectId, lastActivity: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateTimestampCol(userId, _.lastactivity, new java.sql.Timestamp(lastActivity))

  def updatePasswordInfo(userId: ObjectId, passwordInfo: PasswordInfo)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(sqlu"""update webknossos.users set
                          passwordInfo_hasher = '#${sanitize(passwordInfo.hasher)}',
                          passwordInfo_password = ${passwordInfo.password}
                      where _id = ${userId}""")
    } yield ()

  def updateUserConfiguration(userId: ObjectId, userConfiguration: UserConfiguration)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(sqlu"""update webknossos.users
               set userConfiguration = '#${sanitize(Json.toJson(userConfiguration.configuration).toString)}'
               where _id = ${userId}""")
    } yield ()

  def updateValues(userId: ObjectId,
                   firstName: String,
                   lastName: String,
                   email: String,
                   isAdmin: Boolean,
                   isDatasetManager: Boolean,
                   isDeactivated: Boolean,
                   lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext) = {
    val q = for { row <- Users if notdel(row) && idColumn(row) === userId.id } yield
      (row.firstname,
       row.lastname,
       row.email,
       row.logininfoProviderkey,
       row.isadmin,
       row.isdatasetmanager,
       row.isdeactivated,
       row.lasttasktypeid)
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q.update(firstName, lastName, email, email, isAdmin, isDatasetManager, isDeactivated, lastTaskTypeId))
    } yield ()
  }

  def updateLastTaskTypeId(userId: ObjectId, lastTaskTypeId: Option[String])(implicit ctx: DBAccessContext) =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(sqlu"""update webknossos.users
               set lasttasktypeid = ${lastTaskTypeId}
               where _id = ${userId}""")
    } yield ()

}

class UserTeamRolesDAO @Inject()(userDAO: UserDAO, sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findTeamMembershipsForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TeamMembership]] = {
    val query = for {
      (teamRoleRow, team) <- UserTeamRoles.filter(_._User === userId.id) join Teams on (_._Team === _._Id)
    } yield (team._Id, team.name, teamRoleRow.isteammanager)

    for {
      rows: Seq[(String, String, Boolean)] <- run(query.result)
      teamMemberships <- Fox.combined(rows.toList.map {
        case (teamId, teamName, isTeamManager) =>
          ObjectId.parse(teamId).map(teamIdValidated => TeamMembership(teamIdValidated, isTeamManager))
      })
    } yield {
      teamMemberships
    }
  }

  private def insertQuery(userId: ObjectId, teamMembership: TeamMembership) =
    sqlu"insert into webknossos.user_team_roles(_user, _team, isTeamManager) values(${userId}, ${teamMembership.teamId}, ${teamMembership.isTeamManager})"

  def updateTeamMembershipsForUser(userId: ObjectId, teamMemberships: List[TeamMembership])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.user_team_roles where _user = ${userId}"
    val insertQueries = teamMemberships.map(insertQuery(userId, _))
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
    } yield ()
  }

  def insertTeamMembership(userId: ObjectId, teamMembership: TeamMembership)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      _ <- run(insertQuery(userId, teamMembership))
    } yield ()

  def removeTeamFromAllUsers(teamId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      r <- run(sqlu"delete from webknossos.user_team_roles where _team = ${teamId}")
    } yield ()

  def findMemberDifference(potentialSubteam: ObjectId, superteams: List[ObjectId]): Fox[List[User]] =
    for {
      r <- run(sql"""select #${userDAO.columnsWithPrefix("u.")} from webknossos.users_ u
                     join webknossos.user_team_roles tr on u._id = tr._user
                     where not u.isAdmin
                     and not u.isDeactivated
                     and tr._team = $potentialSubteam
                     and u._id not in
                     (select _user from webknossos.user_team_roles
                     where _team in #${writeStructTupleWithQuotes(superteams.map(_.id))})
                     """.as[UsersRow])
      parsed <- Fox.combined(r.toList.map(userDAO.parse))
    } yield parsed
}

class UserExperiencesDAO @Inject()(sqlClient: SQLClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllExperiencesForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[String, Int]] =
    for {
      rows <- run(UserExperiences.filter(_._User === userId.id).result)
    } yield {
      rows.map(r => (r.domain, r.value)).toMap
    }

  def updateExperiencesForUser(userId: ObjectId, experiences: Map[String, Int])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.user_experiences where _user = ${userId}"
    val insertQueries = experiences.map {
      case (domain, value) =>
        sqlu"insert into webknossos.user_experiences(_user, domain, value) values(${userId}, ${domain}, ${value})"
    }
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
    } yield ()
  }

}

class UserDataSetConfigurationDAO @Inject()(sqlClient: SQLClient, userDAO: UserDAO, dataSetDAO: DataSetDAO)(
    implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[ObjectId, JsValue]] =
    for {
      rows <- run(UserDatasetconfigurations.filter(_._User === userId.id).result)
    } yield {
      rows.map(r => (ObjectId(r._Dataset), Json.parse(r.configuration).as[JsValue])).toMap
    }

  def findOneForUserAndDataset(userId: ObjectId, dataSetName: String)(implicit ctx: DBAccessContext): Fox[JsValue] =
    for {
      rows <- run(sql"""select c.configuration
              from webknossos.user_dataSetConfigurations c
              join webknossos.dataSets_ d on c._dataSet = d._id
              where d.name = ${dataSetName}
              and c._user = ${userId}
          """.as[String])
      parsed = rows.map(Json.parse)
      result <- parsed.headOption.toFox
    } yield result

  def updateDatasetConfigurationForUserAndDataset(
      userId: ObjectId,
      dataSetId: ObjectId,
      configuration: Map[String, JsValue])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = sqlu"""delete from webknossos.user_dataSetConfigurations
               where _user = ${userId} and _dataSet = ${dataSetId}"""
      insertQuery = sqlu"""insert into webknossos.user_dataSetConfigurations(_user, _dataSet, configuration)
               values(${userId}, ${dataSetId}, '#${sanitize(Json.toJson(configuration).toString)}')"""
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()

  def insertDatasetConfigurationsFor(userId: ObjectId, configurations: Map[String, DataSetConfiguration])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- Fox.combined(configurations.map {
        case (dataSetName, configuration) =>
          insertDatasetConfiguration(userId, dataSetName, configuration.configuration)
      }.toList)
    } yield ()

  private def insertDatasetConfiguration(userId: ObjectId, dataSetName: String, configuration: Map[String, JsValue])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      user <- userDAO.findOne(userId)
      dataSet <- dataSetDAO.findOneByNameAndOrganization(dataSetName, user._organization)
      _ <- insertDatasetConfiguration(userId, dataSet._id, configuration)
    } yield ()

  private def insertDatasetConfiguration(userId: ObjectId, dataSetId: ObjectId, configuration: Map[String, JsValue])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      _ <- run(sqlu"""insert into webknossos.user_dataSetConfigurations(_user, _dataSet, configuration)
               values ('#${sanitize(configuration.toString)}', ${userId} and _dataSet = ${dataSetId})""")
    } yield ()

}

class UserDataSetLayerConfigurationDAO @Inject()(sqlClient: SQLClient, userDAO: UserDAO)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllByLayerNameForUserAndDataset(layerNames: List[String], userId: ObjectId, dataSetName: String)(
      implicit ctx: DBAccessContext): Fox[Map[String, JsValue]] =
    for {
      rows <- run(sql"""select layerName, configuration
              from webknossos.user_dataSetLayerConfigurations
              where _dataset in (select _id from webknossos.dataSets_ where name = $dataSetName)
              and _user = $userId
              and layerName in #${writeStructTupleWithQuotes(layerNames)}
          """.as[(String, String)])
      parsed = rows.map(t => (t._1, Json.parse(t._2)))
    } yield parsed.toMap

  def updateDatasetConfigurationForUserAndDatasetAndLayer(
      userId: ObjectId,
      dataSetId: ObjectId,
      layerName: String,
      configuration: JsValue)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- userDAO.assertUpdateAccess(userId)
      deleteQuery = sqlu"""delete from webknossos.user_dataSetLayerConfigurations
               where _user = $userId and _dataSet = $dataSetId and layerName = $layerName"""
      insertQuery = sqlu"""insert into webknossos.user_dataSetLayerConfigurations(_user, _dataSet, layerName, configuration)
               values($userId, $dataSetId, $layerName, '#${sanitize(configuration.toString)}')"""
      _ <- run(
        DBIO.sequence(List(deleteQuery, insertQuery)).transactionally.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()
}
