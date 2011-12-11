package models

import play.api.db._
import play.api.Play.current

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO


case class User(email: String, name: String, password: String, verified: Boolean, _id: ObjectId = new ObjectId)

object User extends BasicDAO[User]("users"){

  def findByEmail(email: String) = findOne(MongoDBObject(
    "email" -> email
  ))

  def findAll = find(MongoDBObject.empty).toList

  def authenticate(email: String, password: String) = findOne(MongoDBObject(
    "email" -> email,
    "password" -> password
  ))

  def create(user: User) = {
    insert(user)
    user
  }

}