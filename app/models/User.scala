package models

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

case class User(
    email: String,
    name: String,
    verified: Boolean = false,
    pwdHash: String = "",
    loginType: String = "local",
    configuration: UserConfiguration = UserConfiguration.defaultConfiguration,
    roles: List[String] = "user" :: Nil,
    permissions: List[Permission] = Nil,
    var branchPoints: List[BranchPoint] = Nil,
    _id: ObjectId = new ObjectId ) {

  val _roles = for{
    roleName <- roles
    role <- Role.findOneByName(roleName)
  } yield role
  
  val ruleSet: List[Implyable] = 
    ( permissions ++ _roles )

  
  def hasRole( role: Role ) = 
    _roles.find( _.name == role.name ).isDefined

  def hasPermission( permission: Permission ) =
    ruleSet.find( _.implies( permission ) ).isDefined
    
  def useBranchPointAsOrigin = {
    branchPoints match {
      case head :: tail => 
        User.save( this.copy( branchPoints = tail ) )
        branchPoints = tail
        Some( head )
      case _ =>
        None
    }
    
  } 
  
  def id = _id.toString
}

object User extends BasicDAO[User]( "users" ) {

  val LocalLoginType = "local"
  
  def findOneByEmail( email: String ) = findOne( MongoDBObject(
    "email" -> email ) )
  
  def findLocalByEmail( email: String ) = findOne( MongoDBObject(
    "email" -> email, "loginType" -> LocalLoginType ) )
  
  def findOneById( id: String): Option[User] = findOneByID( new ObjectId(id) )
  
  def authRemote( email: String, loginType: String) = 
    findOne( MongoDBObject( "email" -> email, "loginType" -> loginType ) )

  def auth( email: String, password: String ) =
    for {
      user <- findOne( MongoDBObject( "email" -> email, "loginType" -> LocalLoginType ) )
      if verifyPassword( password, user.pwdHash )
    } yield user

  def create( email: String, name: String, password: String = "" ) = {
    val user = User( email, name, false, hashPassword( password ) )
    insert( user )
    user
  }
    
  def verify( validationKey: String) = {
    ValidationKey.find( validationKey ).map{ user =>
      ValidationKey.remove( validationKey )
      save( user.copy( verified = true ) )
      true
    } getOrElse false
  }

  def createRemote( email: String, name: String, loginType: String ) = {
    val user = User( email, name, true, "", loginType )
    insert( user )
    user
  }
}