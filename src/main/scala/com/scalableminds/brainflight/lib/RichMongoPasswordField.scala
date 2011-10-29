package com.scalableminds.brainflight.lib

import net.liftweb.mongodb.record.BsonRecord
import net.liftweb.common.Box
import net.liftweb.record.TypedField
import net.liftweb.http.S._
import net.liftweb.mongodb.record.field.{Password, MongoPasswordField}
import net.liftweb.util.FieldError
import net.liftweb.util.FieldError._
import xml.Text._
import xml.Text

/**
 * Created by IntelliJ IDEA.
 * User: tombocklisch
 * Date: 29.10.11
 * Time: 19:35
 * To change this template use File | Settings | File Templates.
 */

class RichMongoPasswordField[OwnerType <: BsonRecord[OwnerType]](rec: OwnerType, _confirmField: Box[TypedField[String]]) extends MongoPasswordField(rec, 6) {
  /**
   * Extends Mongos password field to provide the ability to use another
   * StringField to create a confirm password field
   */
  override def displayName = ??("password")

  private def valMatch(msg: => String)(pass: Password): List[FieldError] = pass match {
    //compare confirm password with original password
    case Password(pwd, _) =>
      _confirmField.filterNot(_.get == pwd).map(p =>
        FieldError(this, Text(msg))
      ).toList
  }

  override def validations =
    valMatch(?("passwords.dont.match")) _ ::
      super.validations
}