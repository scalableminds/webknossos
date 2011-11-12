package com.scalableminds.brainflight.model
import scala.xml.{NodeSeq, Text}

import net.liftweb.common._
import net.liftweb.util._
import net.liftweb.util.Helpers._

import com.scalableminds.brainflight.lib._
import net.liftweb.http.S._
import net.liftweb.record.{Record, TypedField}
import net.liftweb.mongodb.record.BsonRecord
import net.liftweb.record.field.{StringField, PasswordField}
import net.liftweb.mongodb.record.field.{BsonRecordListField, ObjectIdRefListField, Password, MongoPasswordField}
import org.bson.types.ObjectId

/**
* The singleton that has methods for accessing the database
*/
object User extends User with MetaMegaProtoUser[User] {
  override def collectionName = "users" // define the MongoDB collection name

  // when the user is going to get logged out, the current route needs to get saved
  onLogOut ::= SessionRoute.saveRoute _

  override def screenWrap = Full(<lift:surround with="default" at="content">
            <lift:bind /></lift:surround>)
  override def skipEmailValidation = true // uncomment this line to skip email validations

  override def localForm(user: User, ignorePassword: Boolean): NodeSeq = {
    /* This doesn't work either
    for {
      f <- signupFields
    } yield
      <tr><td>{f.displayName}</td><td>{f.toForm}</td></tr>
    */
    val formXhtml: NodeSeq = {
      <tr><td>{user.firstName.displayName}</td><td>{user.firstName.toForm openOr Text("")}</td></tr>
      <tr><td>{user.email.displayName}</td><td>{user.email.toForm openOr Text("")}</td></tr>
    }

    if (!ignorePassword)
      formXhtml ++ <tr><td>{user.password.displayName}</td><td>{user.password.toForm openOr Text("")}</td></tr>
                   <tr><td>{user.repassword.displayName}</td><td>{user.repassword.toForm openOr Text("")}</td></tr>
    else
      formXhtml
  }

}

/**
* A "User" class that includes first name, last name, password
*/
class User extends MegaProtoUser[User] {
  def meta = User // what's the "meta" server

  // all routes the user creates are connected to his user profile
  object flightRoutes extends ObjectIdRefListField(this, FlightRoute)
}
