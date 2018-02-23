package models.user

import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.api.{Identity, LoginInfo}
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.reactivemongo._
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.schema.Tables._
import models.binary.DataSetSQLDAO
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO, SimpleSQLDAO}



case class UserSQL(
                  _id: ObjectId,
                  email: String,
                  firstName: String,
                  lastName: String,
                  lastActivity: Long = System.currentTimeMillis(),
                  userConfiguration: JsValue,
                  md5hash: String,
                  loginInfo: LoginInfo,
                  passwordInfo: PasswordInfo,
                  isSuperUser: Boolean,
                  isDeactivated: Boolean,
                  created: Long = System.currentTimeMillis(),
                  isDeleted: Boolean = false
                  )

object UserSQL {
  def fromUser(user: User)(implicit ctx: DBAccessContext): Fox[UserSQL] =
    Fox.successful(UserSQL(
      ObjectId.fromBsonId(user._id),
      user.email,
      user.firstName,
      user.lastName,
      user.lastActivity,
      Json.toJson(user.userConfiguration.configuration),
      user.md5hash,
      user.loginInfo,
      user.passwordInfo,
      user.isSuperUser,
      !user.isActive,
      System.currentTimeMillis()))
}

object UserSQLDAO extends SQLDAO[UserSQL, UsersRow, Users] {
  val collection = Users

  def idColumn(x: Users): Rep[String] = x._Id
  def isDeletedColumn(x: Users): Rep[Boolean] = x.isdeleted

  def parse(r: UsersRow): Fox[UserSQL] =
    Fox.successful(UserSQL(
      ObjectId(r._Id),
      r.email,
      r.firstname,
      r.lastname,
      r.lastactivity.getTime,
      Json.parse(r.userconfiguration),
      r.md5hash,
      LoginInfo(r.logininfoProviderid, r.logininfoProviderkey),
      PasswordInfo(r.passwordinfoHasher, r.passwordinfoPassword),
      r.issuperuser,
      r.isdeactivated,
      r.created.getTime,
      r.isdeleted
    ))

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""_id not in (select _user from webknossos.user_team_roles)
       or (_id in (select _user from webknossos.user_team_roles where _team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')))"""
  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""_id not in (select _user from webknossos.user_team_roles)
       or (_id in (select _user from webknossos.user_team_roles where _team in (select _team from webknossos.user_team_roles where role = '${Role.Admin.name}' and _user = '${requestingUserId.id}')))"""


  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[UserSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select * from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[UsersRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[UserSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select * from #${existingCollectionName} where #${accessQuery}".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext): Fox[UserSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select * from #${existingCollectionName} where email = ${email} and #${accessQuery}".as[UsersRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def findAllByTeams(teams: List[ObjectId], includeDeactivated: Boolean = true)(implicit ctx: DBAccessContext) =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select u.*
                       from (select * from #${existingCollectionName} where #${accessQuery}) u join webknossos.user_team_roles on u._id = webknossos.user_team_roles._user
                       where webknossos.user_team_roles._team in #${writeStructTupleWithQuotes(teams.map(_.id))}
                             and (u.isDeactivated = false or u.isDeactivated = ${includeDeactivated})""".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByIds(ids: List[ObjectId])(implicit ctx: DBAccessContext): Fox[List[UserSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select * from #${existingCollectionName} where _id in #${writeStructTupleWithQuotes(ids.map(_.id))} and #${accessQuery}".as[UsersRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed


  def insertOne(u: UserSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.users(_id, email, firstName, lastName, lastActivity, userConfiguration, md5hash, loginInfo_providerID,
                                            loginInfo_providerKey, passwordInfo_hasher, passwordInfo_password, isDeactivated, isSuperUser, created, isDeleted)
                                            values(${u._id.id}, ${u.email}, ${u.firstName}, ${u.lastName}, ${new java.sql.Timestamp(u.lastActivity)},
                                                   '#${sanitize(Json.toJson(u.userConfiguration).toString)}', ${u.md5hash}, '#${sanitize(u.loginInfo.providerID)}', ${u.loginInfo.providerKey},
                                                   '#${sanitize(u.passwordInfo.hasher)}', ${u.passwordInfo.password}, ${u.isDeactivated}, ${u.isSuperUser},
                                                   ${new java.sql.Timestamp(u.created)}, ${u.isDeleted})
          """)
    } yield ()

  def updateLastActivity(userId: ObjectId, lastActivity: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateTimestampCol(userId, _.lastactivity, new java.sql.Timestamp(lastActivity))

  def updatePasswordInfo(userId: ObjectId, passwordInfo: PasswordInfo)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) === userId.id)} yield (row.passwordinfoHasher, row.passwordinfoPassword)
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(sqlu"""update webknossos.users set
                          passwordInfo_hasher = '#${sanitize(passwordInfo.hasher)}',
                          passwordInfo_password = ${passwordInfo.password}
                      where _id = ${userId.id}""")
    } yield ()
  }

  def updateUserConfiguration(userId: ObjectId, userConfiguration: UserConfiguration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(
        sqlu"""update webknossos.users
               set userConfiguration = '#${sanitize(Json.toJson(userConfiguration.configuration).toString)}'
               where _id = ${userId.id}""")
    } yield ()

  def updateValues(userId: ObjectId, firstName: String, lastName: String, isDeactivated: Boolean)(implicit ctx: DBAccessContext) = {
    val q = for {row <- Users if (notdel(row) && idColumn(row) === userId.id)} yield (row.firstname, row.lastname, row.isdeactivated)
    for {
      _ <- assertUpdateAccess(userId)
      _ <- run(q.update(firstName, lastName, isDeactivated))
    } yield ()
  }

}




object UserTeamRolesSQLDAO extends SimpleSQLDAO {

  def findTeamMembershipsForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TeamMembership]] = {
    val query = for {
      (role, team) <- UserTeamRoles.filter(_._User === userId.id) join Teams  on (_._Team === _._Id)
    } yield (team.name, role.role)

    for {
      rows: Seq[(String, String)] <- run(query.result)
    } yield {
      rows.toList.map { case (teamName, role) => TeamMembership(teamName, Role(role)) }
    }
  }

  private def insertQuery(userId: ObjectId, teamMembership: TeamMembershipSQL) =
    sqlu"insert into webknossos.user_team_roles(_user, _team, role) values(${userId.id}, ${teamMembership.teamId.id}, '#${sanitize(teamMembership.role.name)}')"

  def updateTeamMembershipsForUser(userId: ObjectId, teamMemberships: List[TeamMembershipSQL])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.user_team_roles where _user = ${userId.id}"
    val insertQueries = teamMemberships.map(insertQuery(userId, _))
    for {
      _ <- UserSQLDAO.assertUpdateAccess(userId)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
    } yield ()
  }

  def insertTeamMembership(userId: ObjectId, teamMembership: TeamMembershipSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- UserSQLDAO.assertUpdateAccess(userId)
      _ <- run(insertQuery(userId, teamMembership))
    } yield ()


  def removeTeamFromAllUsers(teamId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      r <- run(sqlu"delete from webknossos.user_team_roles where _team = ${teamId.id}")
    } yield ()

}

object UserExperiencesSQLDAO extends SimpleSQLDAO {

  def findAllExperiencesForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[String, Int]] = {
    for {
      rows <- run(UserExperiences.filter(_._User === userId.id).result)
    } yield {
      rows.map(r => (r.domain, r.value)).toMap
    }
  }

  def updateExperiencesForUser(userId: ObjectId, experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.user_experiences where _user = ${userId.id}"
    val insertQueries = experiences.map { case (domain, value) => sqlu"insert into webknossos.user_experiences(_user, domain, value) values(${userId.id}, ${domain}, ${value})"}
    for {
      _ <- UserSQLDAO.assertUpdateAccess(userId)
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
    } yield ()
  }

}

object UserDataSetConfigurationsSQLDAO extends SimpleSQLDAO {

  def findAllForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[ObjectId, JsValue]] = {
    for {
      rows <- run(UserDatasetconfigurations.filter(_._User === userId.id).result)
    } yield {
      rows.map(r => (ObjectId(r._Dataset), Json.parse(r.configuration).as[JsValue])).toMap
    }
  }

  def updateDatasetConfigurationForUserAndDataset(userId: ObjectId, dataSetId: ObjectId, configuration: Map[String, JsValue])(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- UserSQLDAO.assertUpdateAccess(userId)
      _ <- run(
        sqlu"""update webknossos.user_dataSetConfigurations
               set configuration = '#${sanitize(configuration.toString)}'
               where _user = ${userId.id} and _dataSet = ${dataSetId.id}""")
    } yield ()
  }

  def insertDatasetConfigurationsFor(userId: ObjectId, configurations: Map[String, DataSetConfiguration])(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- Fox.combined(configurations.map{case (dataSetName, configuration) => insertDatasetConfiguration(userId, dataSetName, configuration.configuration)}.toList)
    } yield ()
  }

  private def insertDatasetConfiguration(userId: ObjectId, dataSetName: String, configuration: Map[String, JsValue])(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      dataSet <- DataSetSQLDAO.findOneByName(dataSetName)
      _ <- insertDatasetConfiguration(userId, dataSet._id, configuration)
    } yield ()
  }

  private def insertDatasetConfiguration(userId: ObjectId, dataSetId: ObjectId, configuration: Map[String, JsValue])(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- UserSQLDAO.assertUpdateAccess(userId)
      _ <- run(
        sqlu"""insert into webknossos.user_dataSetConfigurations(_user, _dataSet, configuration)
               values ('#${sanitize(configuration.toString)}', ${userId.id} and _dataSet = ${dataSetId.id})""")
    } yield ()
  }

}


case class User(
                 email: String,
                 firstName: String,
                 lastName: String,
                 isActive: Boolean = false,
                 md5hash: String = "",
                 teams: List[TeamMembership],
                 userConfiguration: UserConfiguration = UserConfiguration.default,
                 dataSetConfigurations: Map[String, DataSetConfiguration] = Map.empty,
                 experiences: Map[String, Int] = Map.empty,
                 lastActivity: Long = System.currentTimeMillis,
                 _isAnonymous: Option[Boolean] = None,
                 _isSuperUser: Option[Boolean] = None,
                 _id: BSONObjectID = BSONObjectID.generate,
                 loginInfo: LoginInfo,
                 passwordInfo: PasswordInfo) extends DBAccessContextPayload with Identity {

  def teamsWithRole(role: Role) = teams.filter(_.role == role)

  def teamNames = teams.map(_.team)

  def isSuperUser = _isSuperUser getOrElse false

  def isAnonymous = _isAnonymous getOrElse false

  val name = firstName + " " + lastName

  val abreviatedName =
    (firstName.take(1) + lastName).toLowerCase.replace(" ", "_")

  lazy val id = _id.stringify

  lazy val adminTeams = teamsWithRole(Role.Admin)

  lazy val adminTeamNames = adminTeams.map(_.team)

  lazy val hasAdminAccess = adminTeams.nonEmpty

  def roleInTeam(team: String) = teams.find(_.team == team).map(_.role)

  def isAdminOf(team: String) = adminTeamNames.contains(team)

  def isAdmin = adminTeams.nonEmpty

  override def toString = email

  def setExperience(name: String, value: Int) = {
    val n = name.trim
    this.copy(experiences = this.experiences + (n -> value))
  }

  def increaseExperience(name: String, value: Int) = {
    val n = name.trim
    this.copy(experiences = this.experiences + (n -> (this.experiences.getOrElse(n, default = 0) + value)))
  }

  def deleteExperience(name: String) = {
    val n = name.trim
    this.copy(experiences = this.experiences.filterNot(_._1 == n))
  }

  def logActivity(time: Long) =
    this.copy(lastActivity = time)

  def activate =
    this.copy(isActive = true)

  def deactivate =
    this.copy(isActive = false)

  def addTeam(teamMemberships: List[TeamMembership]) =
    this.copy(teams = teamMemberships ::: teams)

  def removeTeam(team: String) =
    this.copy(teams = teams.filterNot(_.team == team))

  def lastActivityDays =
    (System.currentTimeMillis - this.lastActivity) / (1000 * 60 * 60 * 24)

  def isEditableBy(other: User) =
    other.hasAdminAccess && ( teams.isEmpty || teamNames.exists(other.isAdminOf))

  def isAdminOfOrSelf(other: User) =
    other._id == _id || isAdminOf(other)

  def isAdminOf(user: User): Boolean =
    user.teamNames.intersect(this.adminTeamNames).nonEmpty

}

object User extends FoxImplicits {

  implicit val passwordInfoJsonFormat = Json.format[PasswordInfo]
  implicit val userFormat = Json.format[User]

  def userPublicWrites(requestingUser: User): Writes[User] =
    ((__ \ "id").write[String] and
      (__ \ "email").write[String] and
      (__ \ "firstName").write[String] and
      (__ \ "lastName").write[String] and
      (__ \ "isActive").write[Boolean] and
      (__ \ "teams").write[List[TeamMembership]] and
      (__ \ "experiences").write[Map[String, Int]] and
      (__ \ "lastActivity").write[Long] and
      (__ \ "isAnonymous").write[Boolean] and
      (__ \ "isEditable").write[Boolean])(u =>
      (u.id, u.email, u.firstName, u.lastName, u.isActive, u.teams, u.experiences,
        u.lastActivity, u.isAnonymous, u.isEditableBy(requestingUser)))

  def userCompactWrites: Writes[User] =
    ((__ \ "id").write[String] and
      (__ \ "email").write[String] and
      (__ \ "firstName").write[String] and
      (__ \ "lastName").write[String] and
      (__ \ "isAnonymous").write[Boolean] and
      (__ \ "teams").write[List[TeamMembership]])( u =>
      (u.id, u.email, u.firstName, u.lastName, u.isAnonymous, u.teams))

  val defaultDeactivatedUser = User("","","", teams = Nil, loginInfo = LoginInfo(CredentialsProvider.ID, ""), passwordInfo = PasswordInfo("SCrypt", ""))


  private def constructDatasetConfigurations(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[String, DataSetConfiguration]] =
    for {
      jsValueByDatasetName <- fetchDatasetConfigurations(userId)
    } yield {
      jsValueByDatasetName.mapValues(v => DataSetConfiguration(v.validate[Map[String, JsValue]].getOrElse(Map.empty)))
    }

  private def fetchDatasetConfigurations(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Map[String, JsValue]] = {
    for {
      jsValueByDataSetId: Map[ObjectId, JsValue] <- UserDataSetConfigurationsSQLDAO.findAllForUser(userId)
      keyList: List[ObjectId] = jsValueByDataSetId.keySet.toList
      dataSets <- Fox.combined(keyList.map(dataSetId => DataSetSQLDAO.findOne(dataSetId)))
    } yield {
      keyList.zip(dataSets).map(Function.tupled((dataSetId, dataSet) => (dataSet.name, jsValueByDataSetId(dataSetId)))).toMap
    }
  }

  def fromUserSQL(s: UserSQL)(implicit ctx: DBAccessContext): Fox[User] = {
    for {
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
      teamRoles <- UserTeamRolesSQLDAO.findTeamMembershipsForUser(s._id)(GlobalAccessContext)
      experiences <- UserExperiencesSQLDAO.findAllExperiencesForUser(s._id)(GlobalAccessContext)
      userConfiguration <- JsonHelper.jsResultToFox(s.userConfiguration.validate[Map[String, JsValue]])
      dataSetConfigurations <- constructDatasetConfigurations(s._id)(GlobalAccessContext)
    } yield {
      User(
        s.email,
        s.firstName,
        s.lastName,
        !s.isDeactivated,
        s.md5hash,
        teamRoles,
        UserConfiguration(userConfiguration),
        dataSetConfigurations,
        experiences,
        s.lastActivity,
        None,
        Some(s.isSuperUser),
        idBson,
        s.loginInfo,
        s.passwordInfo
      )
    }
  }
}


object UserDAO {
  def findOneByEmail(email: String)(implicit ctx: DBAccessContext) =
    for {
      userSQL <- UserSQLDAO.findOneByEmail(email)
      user <- User.fromUserSQL(userSQL)
    } yield user

  def findByTeams(teams: List[String], includeInactive: Boolean = true)(implicit ctx: DBAccessContext) =
    for {
      teams <- Fox.combined(teams.map(TeamSQLDAO.findOneByName(_)))
      usersSQL <- UserSQLDAO.findAllByTeams(teams.map(_._id), includeInactive)
      users <- Fox.combined(usersSQL.map(User.fromUserSQL(_)))
    } yield users

  def update(_user: BSONObjectID, firstName: String, lastName: String, activated: Boolean, teams: List[TeamMembership], experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[User] =
    for {
      teamMembershipsSQL <- Fox.combined(teams.map(TeamMembershipSQL.fromTeamMembership(_)))
      id = ObjectId.fromBsonId(_user)
      _ <- UserSQLDAO.updateValues(id, firstName, lastName, !activated)
      _ <- UserTeamRolesSQLDAO.updateTeamMembershipsForUser(id, teamMembershipsSQL)
      _ <- UserExperiencesSQLDAO.updateExperiencesForUser(id, experiences)
      updated <- findOneById(_user.stringify)
    } yield updated

  def addTeam(_user: BSONObjectID, team: TeamMembership)(implicit ctx: DBAccessContext) =
    for {
      teamMembershipSQL <- TeamMembershipSQL.fromTeamMembership(team)
      _ <- UserTeamRolesSQLDAO.insertTeamMembership(ObjectId.fromBsonId(_user), teamMembershipSQL)
    } yield ()

  def updateTeams(_user: BSONObjectID, teamMemberships: List[TeamMembership])(implicit ctx: DBAccessContext) =
    for {
      teamMembershipsSQL <- Fox.combined(teamMemberships.map(TeamMembershipSQL.fromTeamMembership(_)))
      _ <- UserTeamRolesSQLDAO.updateTeamMembershipsForUser(ObjectId.fromBsonId(_user), teamMembershipsSQL)
    } yield ()

  def removeTeamFromUsers(_team: BSONObjectID)(implicit ctx: DBAccessContext) =
    UserTeamRolesSQLDAO.removeTeamFromAllUsers(ObjectId.fromBsonId(_team))

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) =
    UserSQLDAO.updateUserConfiguration(ObjectId.fromBsonId(user._id), configuration)

  def updateDataSetConfiguration(user: User, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) =
    for {
      dataSet <- DataSetSQLDAO.findOneByName(dataSetName)
      _ <- UserDataSetConfigurationsSQLDAO.updateDatasetConfigurationForUserAndDataset(ObjectId.fromBsonId(user._id), dataSet._id, configuration.configuration)
    } yield ()

  def logActivity(_user: BSONObjectID, lastActivity: Long)(implicit c: DBAccessContext) =
    UserSQLDAO.updateLastActivity(ObjectId.fromBsonId(_user), lastActivity)

  def changePasswordInfo(_user: BSONObjectID, passwordInfo: PasswordInfo)(implicit ctx: DBAccessContext) =
    UserSQLDAO.updatePasswordInfo(ObjectId.fromBsonId(_user), passwordInfo)

  def findAllByIds(ids: List[BSONObjectID])(implicit ctx: DBAccessContext) =
    for {
      usersSQL <- UserSQLDAO.findAllByIds(ids.map(ObjectId.fromBsonId(_)))
      users <- Fox.combined(usersSQL.map(User.fromUserSQL(_)))
    } yield users

  def findAll(implicit ctx: DBAccessContext) =
    for {
      usersSQL <- UserSQLDAO.findAll
      users <- Fox.combined(usersSQL.map(User.fromUserSQL(_)))
    } yield users

  def countAll(implicit ctx: DBAccessContext) =
    UserSQLDAO.countAll

  def findOneById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[User] =
    findOneById(id.stringify)

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[User] =
    for {
      userSQL <- UserSQLDAO.findOne(ObjectId(id))
      user <- User.fromUserSQL(userSQL)
    } yield user

  def insert(user: User)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      userSQL: UserSQL <- UserSQL.fromUser(user)
      _ <- UserSQLDAO.insertOne(userSQL)
      teamMemberships <- Fox.combined(user.teams.map(TeamMembershipSQL.fromTeamMembership(_)))
      _ <- Fox.combined(teamMemberships.map(UserTeamRolesSQLDAO.insertTeamMembership(userSQL._id, _)))
      _ <- UserExperiencesSQLDAO.updateExperiencesForUser(userSQL._id, user.experiences)
      _ <- UserDataSetConfigurationsSQLDAO.insertDatasetConfigurationsFor(userSQL._id, user.dataSetConfigurations)
    } yield ()

  def removeById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- UserSQLDAO.deleteOne(ObjectId.fromBsonId(id))
    } yield ()

}
