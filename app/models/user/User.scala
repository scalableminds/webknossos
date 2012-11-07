package models.user

import play.api.db._
import play.api.Play.current
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.security.SCrypt._
import scala.collection.mutable.Stack
import play.api.libs.json.JsValue
import play.api.libs.json.Json._
import scala.collection.immutable.HashMap
import models.basics.BasicDAO
import models.security.Permission
import models.security.Implyable
import models.security.Role
import models.user.Experience._

case class User(
    email: String,
    firstName: String,
    lastName: String,
    verified: Boolean = false,
    pwdHash: String = "",
    loginType: String = "local",
    configuration: UserConfiguration = UserConfiguration.defaultConfiguration,
    roles: Set[String] = Set.empty,
    permissions: List[Permission] = Nil,
    experiences: Experiences = Map.empty,
    _id: ObjectId = new ObjectId) {

  val _roles = for {
    roleName <- roles
    role <- Role.findOneByName(roleName)
  } yield role

  val name = firstName + " " + lastName

  lazy val id = _id.toString

  val ruleSet: List[Implyable] =
    (permissions ++ _roles)

  def hasRole(role: Role) =
    _roles.find(_.name == role.name).isDefined

  def hasPermission(permission: Permission) =
    ruleSet.find(_.implies(permission)).isDefined

  override def toString = email
}

object User extends BasicDAO[User]("users") {

  def default = findLocalByEmail("scmboy@scalableminds.com").get

  val LocalLoginType = "local"

  def findOneByEmail(email: String) = findOne(MongoDBObject(
    "email" -> email))

  def findLocalByEmail(email: String) = findOne(MongoDBObject(
    "email" -> email, "loginType" -> LocalLoginType))

  def authRemote(email: String, loginType: String) =
    findOne(MongoDBObject("email" -> email, "loginType" -> loginType))

  def auth(email: String, password: String) =
    for {
      user <- findOne(MongoDBObject("email" -> email, "loginType" -> LocalLoginType))
      if verifyPassword(password, user.pwdHash)
    } yield user

  def create(email: String, firstName: String, lastName: String, password: String = "") = {
    alterAndInsert(User(email, firstName, lastName, false, hashPassword(password)))
  }

  def saveSettings(user: User, config: UserConfiguration) = {
    alterAndSave(user.copy(configuration = config))
  }
  
  def addExperience(user: User, name: String, value: Int) = {
    alterAndSave(user.copy(experiences = user.experiences + (name -> value)))
  }

  def verify(user: User) = {
    alterAndSave(user.copy(verified = true, roles = user.roles + "user"))
  }

  def addRole(user: User, role: String) = {
    alterAndSave(user.copy(roles = user.roles + role))
  }
  def removeRole(user: User, role: String) = {
    alterAndSave(user.copy(roles = user.roles.filterNot( _ == role)))
  }

  def createRemote(email: String, firstName: String, lastName: String, loginType: String) = {
    alterAndInsert(User(email, firstName, lastName, true, "", loginType = loginType))
  }
}