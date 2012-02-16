package models

import play.api.db._
import play.api.Play.current

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.security.SCrypt._
import scala.collection.mutable.Stack
import brainflight.tools.geometry.TransformationMatrix

case class User(
    email: String,
    name: String,
    verified: Boolean = false,
    pwdHash: String = "",
    loginType: String = "local",
    roles: List[String] = "user" :: Nil,
    permissions: List[Permission] = Nil,
    branchPoints: List[TransformationMatrix] = Nil,
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
}

object User extends BasicDAO[User]( "users" ) {

  val LocalLoginType = "local"

  def findByEmail( email: String ) = findOne( MongoDBObject(
    "email" -> email ) )

  def findAll = find( MongoDBObject.empty ).toList

  def authenticate( email: String, password: String ) =
    for {
      user <- findOne( MongoDBObject( "email" -> email, "loginType" -> LocalLoginType ) )
      if verifyPassword( password, user.pwdHash )
    } yield user

  def create( email: String, name: String, password: String = "" ) = {
    val user = User( email, name, false, hashPassword( password ) )
    insert( user )
    user
  }

  def createRemote( email: String, name: String, loginType: String ) = {
    val user = User( email, name, true, "", loginType )
    insert( user )
    user
  }
}