package models

import play.api.db._
import play.api.Play.current

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.security.SCrypt._


case class User(email: String, name: String, verified: Boolean = false, pwdHash: String = "", _id: ObjectId = new ObjectId)

object User extends BasicDAO[User]("users"){
  
  def findByEmail(email: String) = findOne(MongoDBObject(
    "email" -> email
  ))

  def findAll = find(MongoDBObject.empty).toList

  def authenticate(email: String, password: String) = 
    for{
      user <- findOne(MongoDBObject("email" -> email))
      if verifyPassword(password,user.pwdHash) 
    } yield user

  def create(email: String, name: String, password: String) = {
    val user = User(email,name,false,hashPassword(password))
    insert(user)
    user
  }
}