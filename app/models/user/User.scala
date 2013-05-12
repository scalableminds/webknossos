package models.user

import play.api.Play.current
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import braingames.security.SCrypt._
import scala.collection.mutable.Stack
import play.api.libs.json.JsValue
import play.api.libs.json.Json._
import scala.collection.immutable.HashMap
import models.basics._
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
    experiences: Map[String, Int] = Map.empty,
    lastActivity: Long = System.currentTimeMillis,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[User] {

  val dao = User

  val _roles = for {
    roleName <- roles
    role <- Role.findOneByName(roleName)
  } yield role

  val name = firstName + " " + lastName
  
  val abreviatedName = (firstName.take(1) + lastName) toLowerCase

  lazy val id = _id.toString

  val ruleSet: List[Implyable] =
    (permissions ++ _roles)

  def hasRole(role: Role) =
    _roles.find(_.name == role.name).isDefined

  def hasPermission(permission: Permission) =
    ruleSet.find(_.implies(permission)).isDefined

  override def toString = email

  def changeSettings(config: UserConfiguration) = {
    this.copy(configuration = config)
  }

  def setExperience(name: String, value: Int) = {
    val n = name.trim
    this.copy(experiences = this.experiences + (n -> value))
  }
  
  def deleteExperience(name: String) = {
    val n = name.trim
    this.copy(experiences = this.experiences.filterNot(_._1 == n))
  }  

  def increaseExperience(name: String, value: Int) = {
    val n = name.trim
    val sum = (this.experiences.get(n) getOrElse 0) + value
    this.copy(experiences = this.experiences + (n -> sum))
  }

  def logActivity(time: Long) = {
    this.copy(lastActivity = time)
  }

  def verify() = {
    this.copy(verified = true, roles = this.roles + "user")
  }

  def addRole(role: String) = {
    this.copy(roles = this.roles + role)
  }

  def deleteRole(role: String) = {
    this.copy(roles = this.roles.filterNot(_ == role))
  }

  def lastActivityDays =
    (System.currentTimeMillis - this.lastActivity) / (1000 * 60 * 60 * 24)
}

object User extends BasicDAO[User]("users") {
  this.collection.ensureIndex("email")

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

  def create(email: String, firstName: String, lastName: String, password: String, isVerified: Boolean): User = {
    val u = User(email, firstName, lastName, false, hashPassword(password))
    
    if(isVerified)
      User.insertOne(u.verify)
    else
      User.insertOne(u)
  }

  def createRemote(email: String, firstName: String, lastName: String, loginType: String) = {
    insertOne(User(email, firstName, lastName, true, "", loginType = loginType))
  }
}