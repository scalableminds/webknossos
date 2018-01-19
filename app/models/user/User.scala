package models.user

import com.mohiva.play.silhouette.api.util.PasswordInfo
import com.mohiva.play.silhouette.api.{Identity, LoginInfo}
import com.mohiva.play.silhouette.impl.providers.CredentialsProvider
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo._
import com.scalableminds.util.tools.Fox
import models.basics._
import models.configuration.{DataSetConfiguration, UserConfiguration}
import models.team._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json._
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json._

import scala.concurrent.Future

case class User(
                 email: String,
                 firstName: String,
                 lastName: String,
                 isActive: Boolean = false,
                 md5hash: String = "",
                 organization: String,
                 teams: List[TeamMembership],
                 userConfiguration: UserConfiguration = UserConfiguration.default,
                 dataSetConfigurations: Map[String, DataSetConfiguration] = Map.empty,
                 experiences: Map[String, Int] = Map.empty,
                 lastActivity: Long = System.currentTimeMillis,
                 isAdmin: Boolean = false,
                 _isAnonymous: Option[Boolean] = None,
                 _isSuperUser: Option[Boolean] = None,
                 _id: BSONObjectID = BSONObjectID.generate,
                 loginInfo: LoginInfo,
                 passwordInfo: PasswordInfo) extends DBAccessContextPayload with Identity {

  def teamIds = teams.map(_._id)

  def isSuperUser = _isSuperUser getOrElse false

  def isAnonymous = _isAnonymous getOrElse false

  val name = firstName + " " + lastName

  val abreviatedName =
    (firstName.take(1) + lastName).toLowerCase.replace(" ", "_")

  lazy val id = _id.stringify

  lazy val supervisorTeams = teams.filter(_.isSuperVisor)

  lazy val supervisorTeamIds = supervisorTeams.map(_._id)

  lazy val hasAdminAccess = supervisorTeams.nonEmpty //adminTeams.nonEmpty

  def isSuperVisorOf(team: BSONObjectID) = supervisorTeamIds.contains(team)

  def isAdminOf(organization: String): Boolean = isAdmin && organization == this.organization

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
    this.copy(teams = teams.filterNot(_._id == team))

  def lastActivityDays =
    (System.currentTimeMillis - this.lastActivity) / (1000 * 60 * 60 * 24)

  def isEditableBy(other: User) =
    other.hasAdminAccess && (teams.isEmpty || teamIds.exists(other.isSuperVisorOf)) //TODO

  def isSuperVisorOf(user: User): Boolean =
    user.teamIds.intersect(this.supervisorTeams).nonEmpty
}

object User {

  implicit val passwordInfoJsonFormat: Format[PasswordInfo] = Json.format[PasswordInfo]
  implicit val userFormat = Json.format[User]

  def userPublicWrites(requestingUser: User): Writes[User] =
    ((__ \ "id").write[String] and
      (__ \ "email").write[String] and
      (__ \ "firstName").write[String] and
      (__ \ "lastName").write[String] and
      (__ \ "isActive").write[Boolean] and
      (__ \ "teams").write[List[JsObject]] and
      (__ \ "experiences").write[Map[String, Int]] and
      (__ \ "lastActivity").write[Long] and
      (__ \ "isAnonymous").write[Boolean] and
      (__ \ "isEditable").write[Boolean]) (u =>
      (u.id, u.email, u.firstName, u.lastName, u.isActive, u.teams.map(TeamMembership.teamMembershipPublicWrites(_)), u.experiences,
        u.lastActivity, u.isAnonymous, u.isEditableBy(requestingUser)))

  def userCompactWrites: Writes[User] =
    ((__ \ "id").write[String] and
      (__ \ "email").write[String] and
      (__ \ "firstName").write[String] and
      (__ \ "lastName").write[String] and
      (__ \ "isAnonymous").write[Boolean] and
      (__ \ "teams").write[List[JsObject]]) (u =>
      (u.id, u.email, u.firstName, u.lastName, u.isAnonymous, u.teams.map(TeamMembership.teamMembershipPublicWrites(_))))

  val defaultDeactivatedUser = User("", "", "", organization = "", teams = Nil, loginInfo = LoginInfo(CredentialsProvider.ID, ""), passwordInfo = PasswordInfo("SCrypt", ""))
}

object UserDAO extends SecuredBaseDAO[User] {

  val collectionName = "users"

  implicit val formatter = User.userFormat
  implicit val passwordInfoFormatter = User.passwordInfoJsonFormat

  underlying.indexesManager.ensure(Index(Seq("email" -> IndexType.Ascending)))

  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("$or" -> Json.arr(
            Json.obj("teams._id" -> Json.obj("$in" -> user.teamIds)),
            Json.obj("teams" -> Json.arr()))))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) if user.hasAdminAccess =>
          AllowIf(Json.obj("$or" -> Json.arr(
            Json.obj("teams.team" -> Json.obj("$in" -> user.supervisorTeams)),
            Json.obj("teams" -> Json.arr())
          )))
        case _ =>
          DenyEveryone()
      }
    }
  }

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext) = findOne("email", email)

  def findByTeams(teams: List[BSONObjectID], includeAnonymous: Boolean, includeInactive: Boolean = true)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    val anonymousFilter = if (includeAnonymous) Json.obj() else Json.obj("_isAnonymous" -> Json.obj("$ne" -> true))
    val inactiveFilter = if (includeInactive) Json.obj() else Json.obj("isActive" -> true)
    find(Json.obj("$or" -> teams.map(team => Json.obj("teams.team" -> team))) ++ anonymousFilter ++ inactiveFilter).cursor[User]().collect[List]()
  }

  def findByIdQ(id: BSONObjectID) = Json.obj("_id" -> id)

  def update(_user: BSONObjectID, firstName: String, lastName: String, activated: Boolean, teams: List[TeamMembership], experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[User] =
    findAndModify(findByIdQ(_user), Json.obj("$set" -> Json.obj(
      "firstName" -> firstName,
      "lastName" -> lastName,
      "isActive" -> activated,
      "teams" -> teams,
      "experiences" -> experiences)), returnNew = true)

  def addTeam(_user: BSONObjectID, team: TeamMembership)(implicit ctx: DBAccessContext) =
    update(findByIdQ(_user), Json.obj("$push" -> Json.obj("teams" -> team)))

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(user._id), Json.obj("$set" -> Json.obj("userConfiguration.configuration" -> configuration.configurationOrDefaults)))
  }

  def updateDataSetConfiguration(user: User, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(user._id), Json.obj("$set" -> Json.obj(s"dataSetConfigurations.$dataSetName.configuration" -> configuration.configurationOrDefaults)))
  }

  def logActivity(_user: BSONObjectID, lastActivity: Long)(implicit c: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj("lastActivity" -> lastActivity)))
  }

  def updateTeams(_user: BSONObjectID, teams: List[TeamMembership])(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj("teams" -> teams)))
  }

  def changePasswordInfo(_user: BSONObjectID, pswdInfo: PasswordInfo)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj("passwordInfo" -> pswdInfo)))
  }

  def findAllByIds(ids: List[BSONObjectID])(implicit ctx: DBAccessContext) = {
    find(Json.obj(
      "_id" -> Json.obj("$in" -> Json.toJson(ids))
    )).cursor[User]().collect[List]()
  }

  def findAllNonAnonymous(implicit ctx: DBAccessContext) = {
    find(Json.obj("_isAnonymous" -> Json.obj("$ne" -> true))).cursor[User]().collect[List]()
  }

  def countNonAnonymousUsers(implicit ctx: DBAccessContext) = {
    count(Json.obj("_isAnonymous" -> Json.obj("$ne" -> true)))
  }

  def removeTeamFromUsers(team: String)(implicit ctx: DBAccessContext) = {
    update(
      Json.obj("teams.team" -> team), Json.obj("$pull" -> Json.obj("teams" -> Json.obj("team" -> team))),
      multi = true
    )
  }

  def find(loginInfo: LoginInfo)(implicit ctx: DBAccessContext): Future[Option[User]] =
    findOneByEmail(loginInfo.providerKey).futureBox.map(_.toOption)

  def save(user: User)(implicit ctx: DBAccessContext) =
    insert(user)

}
