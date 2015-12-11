package models.user

import play.api.Play.current
import com.scalableminds.util.security.SCrypt._
import reactivemongo.api.commands.WriteResult

//import scala.collection.mutable.Stack
//import play.api.libs.json.{Json, JsValue}
import play.api.libs.json.Json._
import models.basics._
import models.team._
import models.configuration.{UserConfiguration, DataSetConfiguration}
import com.scalableminds.util.reactivemongo._
//import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.api.indexes.{IndexType, Index}
import reactivemongo.api.indexes.Index
import play.api.libs.json._
import play.api.libs.functional.syntax._
import reactivemongo.core.commands.LastError
import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import com.scalableminds.util.tools.Fox
import play.api.Logger

case class User(
                 email: String,
                 firstName: String,
                 lastName: String,
                 verified: Boolean = false,
                 pwdHash: String = "",
                 md5hash: String = "",
                 teams: List[TeamMembership],
                 userConfiguration: UserConfiguration = UserConfiguration.default,
                 dataSetConfigurations: Map[String, DataSetConfiguration] = Map.empty,
                 experiences: Map[String, Int] = Map.empty,
                 lastActivity: Long = System.currentTimeMillis,
                 _isSuperUser: Option[Boolean] = None,
                 _id: BSONObjectID = BSONObjectID.generate) extends DBAccessContextPayload {

  val dao = User

  //lazy val teamTrees = TeamTreeDAO.findAllTeams(_groups)(GlobalAccessContext)

  def teamsWithRole(role: Role) = teams.filter(_.role == role)

  def teamNames = teams.map(_.team)

  def isSuperUser = _isSuperUser getOrElse false

  val name = firstName + " " + lastName

  val abreviatedName = (firstName.take(1) + lastName) toLowerCase

  lazy val id = _id.stringify

  lazy val adminTeams = teamsWithRole(Role.Admin)

  lazy val adminTeamNames = adminTeams.map(_.team)

  lazy val hasAdminAccess = !adminTeams.isEmpty

  def roleInTeam(team: String) = teams.find(_.team == team).map(_.role)

  override def toString = email

  def setExperience(name: String, value: Int) = {
    val n = name.trim
    this.copy(experiences = this.experiences + (n -> value))
  }

  def increaseExperience(name: String, value: Int) = {
    val n = name.trim
    this.copy(experiences = this.experiences + (n -> (this.experiences.get(n).getOrElse(0) + value)))
  }

  def deleteExperience(name: String) = {
    val n = name.trim
    this.copy(experiences = this.experiences.filterNot(_._1 == n))
  }

  def logActivity(time: Long) =
    this.copy(lastActivity = time)

  def verify =
    this.copy(verified = true)

  def addTeam(teamMemberships: List[TeamMembership]) =
    this.copy(teams = teamMemberships ::: teams)

  def removeTeam(team: String) =
    this.copy(teams = teams.filterNot(_.team == team))

  def lastActivityDays =
    (System.currentTimeMillis - this.lastActivity) / (1000 * 60 * 60 * 24)

  def isEditableBy(other: User) =
    other.hasAdminAccess && ( teams.isEmpty || other.adminTeamNames.exists(teamNames.contains))

}

object User {
  private[user] val userFormat = Json.format[User]

  def userPublicWrites(requestingUser: User): Writes[User] =
    ((__ \ "id").write[String] and
      (__ \ "email").write[String] and
      (__ \ "firstName").write[String] and
      (__ \ "lastName").write[String] and
      (__ \ "verified").write[Boolean] and
      (__ \ "teams").write[List[TeamMembership]] and
      (__ \ "experiences").write[Map[String, Int]] and
      (__ \ "lastActivity").write[Long] and
      (__ \ "isEditable").write[Boolean])(u =>
      (u.id, u.email, u.firstName, u.lastName, u.verified, u.teams, u.experiences, u.lastActivity, u.isEditableBy(requestingUser)))

  def userCompactWrites(requestingUser: User): Writes[User] =
    ((__ \ "id").write[String] and
      (__ \ "email").write[String] and
      (__ \ "firstName").write[String] and
      (__ \ "lastName").write[String] and
      (__ \ "teams").write[List[TeamMembership]])( u =>
      (u.id, u.email, u.firstName, u.lastName, u.teams))

  val createNotVerifiedUser = User("","","", teams = Nil)
}

object UserDAO extends SecuredBaseDAO[User] {

  val collectionName = "users"

  implicit val formatter = User.userFormat

  underlying.indexesManager.ensure(Index(Seq("email" -> IndexType.Ascending)))

  override val AccessDefinitions = new DefaultAccessDefinitions{

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("$or" -> Json.arr(
            Json.obj("teams.team" -> Json.obj("$in" -> user.teamNames)),
            Json.obj("teams" -> Json.arr()))))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) if user.hasAdminAccess =>
          AllowIf(Json.obj("$or" -> Json.arr(
            Json.obj("teams.team" -> Json.obj("$in" -> user.adminTeamNames)),
            Json.obj("teams" -> Json.arr())
            )))
        case _ =>
          DenyEveryone()
      }
    }
  }

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext) = findOne("email", email)

  def findByTeams(teams: List[String])(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj("$or" -> teams.map(team => Json.obj("teams.team" -> team)))).cursor[User].collect[List]()
  }

  def findByIdQ(id: BSONObjectID) = Json.obj("_id" -> id)

  def authRemote(email: String, loginType: String)(implicit ctx: DBAccessContext) =
    findOne(Json.obj("email" -> email, "loginType" -> loginType))

  def auth(email: String, password: String)(implicit ctx: DBAccessContext): Fox[User] =
    findOneByEmail(email).filter { user =>
      verifyPassword(password, user.pwdHash)
    }

  def insert(user: User, isVerified: Boolean)(implicit ctx: DBAccessContext): Fox[User] = {
    if (isVerified) {
      val u = user.verify
      insert(u).map(_ => u)
    } else
      insert(user).map(_ => user)
  }

  def update(_user: BSONObjectID, firstName: String, lastName: String, verified: Boolean, teams: List[TeamMembership], experiences: Map[String, Int])(implicit ctx: DBAccessContext): Fox[WriteResult] =
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj(
      "firstName" -> firstName,
      "lastName" -> lastName,
      "verified" -> verified,
      "teams" -> teams,
      "experiences" -> experiences)))

  def addTeams(_user: BSONObjectID, teams: Seq[TeamMembership])(implicit ctx: DBAccessContext) =
    update(findByIdQ(_user), Json.obj("$pushAll" -> Json.obj("teams" -> teams)))

  def addRole(_user: BSONObjectID, role: String)(implicit ctx: DBAccessContext) =
    update(findByIdQ(_user), Json.obj("$push" -> Json.obj("roles" -> role)))

  def deleteRole(_user: BSONObjectID, role: String)(implicit ctx: DBAccessContext) =
    update(findByIdQ(_user), Json.obj("$pull" -> Json.obj("roles" -> role)))

  def increaseExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$inc" -> Json.obj(s"experiences.$domain" -> value)))
  }

  def updateUserConfiguration(user: User, configuration: UserConfiguration)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(user._id), Json.obj("$set" -> Json.obj("userConfiguration.configuration" -> configuration.configurationOrDefaults)))
  }

  def updateDataSetConfiguration(user: User, dataSetName: String, configuration: DataSetConfiguration)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(user._id), Json.obj("$set" -> Json.obj(s"dataSetConfigurations.$dataSetName.configuration" -> configuration.configurationOrDefaults)))
  }

  def setExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj(s"experiences.$domain" -> value)))
  }

  def deleteExperience(_user: BSONObjectID, domain: String)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$unset" -> Json.obj(s"experiences.$domain" -> 1)))
  }

  def logActivity(_user: BSONObjectID, lastActivity: Long)(implicit c: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj("lastActivity" -> lastActivity)))
  }

  def updateTeams(_user: BSONObjectID, teams: List[TeamMembership])(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj("teams" -> teams)))
  }

  def changePassword(_user: BSONObjectID, pswd: String)(implicit ctx: DBAccessContext) = {
    update(findByIdQ(_user), Json.obj("$set" -> Json.obj("pwdHash" -> hashPassword(pswd))))
  }

  def verify(user: User)(implicit ctx: DBAccessContext) = {
    update(
      Json.obj("email" -> user.email),
      Json.obj("$set" -> Json.obj("verified" -> true)))
  }

  def removeTeamFromUsers(team: String)(implicit ctx: DBAccessContext) = {
    update(
      Json.obj("teams.team" -> team), Json.obj("$pull" -> Json.obj("teams" -> Json.obj("team" -> team))),
      multi = true
    )
  }
}
