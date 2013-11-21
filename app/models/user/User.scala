package models.user

import play.api.Play.current
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import braingames.security.SCrypt._
import scala.collection.mutable.Stack
import play.api.libs.json.{Json, JsValue}
import play.api.libs.json.Json._
import scala.collection.immutable.HashMap
import models.basics._
import models.security.{RoleDAO, Permission, Implyable, Role}
import models.user.Experience._
import models.team.{Team, TeamMembership, TeamTreeDAO, TeamPath}
import braingames.reactivemongo.{DBAccessContext, DBAccessContextPayload}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._

case class User(
  email: String,
  firstName: String,
  lastName: String,
  verified: Boolean = false,
  pwdHash: String = "",
  teams: List[TeamMembership],
  configuration: UserSettings = UserSettings.defaultSettings,
  roles: Set[String] = Set.empty,
  permissions: List[Permission] = Nil,
  experiences: Map[String, Int] = Map.empty,
  lastActivity: Long = System.currentTimeMillis,
  _id: BSONObjectID = BSONObjectID.generate) extends DBAccessContextPayload {

  val dao = User

  //lazy val teamTrees = TeamTreeDAO.findAllTeams(_groups)(GlobalAccessContext)

  val _roles = roles.flatMap(RoleDAO.find)

  val name = firstName + " " + lastName

  val abreviatedName = (firstName.take(1) + lastName) toLowerCase

  lazy val id = _id.stringify

  val ruleSet: List[Implyable] = permissions ++ _roles

  def hasRole(role: Role) =
    roles.find(_ == role.name).isDefined

  def adminTeams =
    teams.filter(_.role == TeamMembership.Admin).map(_.teamPath)

  def hasPermission(permission: Permission) =
    ruleSet.find(_.implies(permission)).isDefined

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

  def logActivity(time: Long) = {
    this.copy(lastActivity = time)
  }

  def verify = {
    this.copy(verified = true, roles = this.roles + "user")
  }

  def addTeamMemberships(teamMemberships: List[TeamMembership]) = {
    this.copy(teams = teamMemberships ::: teams)
  }

  def deleteRole(role: String) = {
    this.copy(roles = this.roles.filterNot(_ == role))
  }

  def lastActivityDays =
    (System.currentTimeMillis - this.lastActivity) / (1000 * 60 * 60 * 24)
}

object User {
  implicit val userFormat = Json.format[User]
}

object UserDAO extends SecuredBaseDAO[User] {
  val collectionName = "users"
  val formatter = User.userFormat

  //TODO: this.collection.ensureIndex("email")

  def findOneByEmail(email: String)(implicit ctx: DBAccessContext) = findOne("email", email)

  def findByIdQ(id: BSONObjectID) = Json.obj("_id" -> id)

  def authRemote(email: String, loginType: String)(implicit ctx: DBAccessContext) =
    findOne(Json.obj("email" -> email, "loginType" -> loginType))

  def auth(email: String, password: String)(implicit ctx: DBAccessContext): Future[Option[User]] =
    findOneByEmail(email).map(_.filter(user => verifyPassword(password, user.pwdHash)))

  def insert(user: User, isVerified: Boolean)(implicit ctx: DBAccessContext): Future[User] = {
    if (isVerified) {
      val u = user.verify
      insert(u).map(_ => u)
    } else
      insert(user).map(_ => user)
  }

  def addTeams(_user: BSONObjectID, teams: Seq[TeamMembership])(implicit ctx: DBAccessContext) =
    collectionUpdate(findByIdQ(_user), Json.obj("$pushAll"-> Json.obj("teams" -> teams)))

  def addRole(_user: BSONObjectID, role: String)(implicit ctx: DBAccessContext) =
    collectionUpdate(findByIdQ(_user), Json.obj("$push"-> Json.obj("roles" -> role)))

  def deleteRole(_user: BSONObjectID, role: String)(implicit ctx: DBAccessContext) =
    collectionUpdate(findByIdQ(_user), Json.obj("$pull"-> Json.obj("roles" -> role)))

  def increaseExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    collectionUpdate(findByIdQ(_user), Json.obj("$inc" -> Json.obj(s"experiences.$domain" -> value)))
  }

  def updateSettings(user: User, settings: UserSettings)(implicit ctx: DBAccessContext) = {
    collectionUpdate(findByIdQ(user._id), Json.obj("$set" -> Json.obj("settings" -> settings)))
  }

  def setExperience(_user: BSONObjectID, domain: String, value: Int)(implicit ctx: DBAccessContext) = {
    collectionUpdate(findByIdQ(_user), Json.obj("$set" -> Json.obj(s"experiences.$domain" -> value)))
  }

  def deleteExperience(_user: BSONObjectID, domain: String)(implicit ctx: DBAccessContext) = {
    collectionUpdate(findByIdQ(_user), Json.obj("$unset" -> Json.obj(s"experiences.$domain" -> 1)))
  }

  def logActivity(user: User, lastActivity: Long)(implicit ctx: DBAccessContext) = {
    collectionUpdate(findByIdQ(user._id), Json.obj("$set" -> Json.obj("lastActivity" -> lastActivity)))
  }

  def verify(user: User, roles: Set[String])(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("email" -> user.email),
      Json.obj("$set" -> Json.obj("roles" -> roles, "verified" -> true)))
  }
}