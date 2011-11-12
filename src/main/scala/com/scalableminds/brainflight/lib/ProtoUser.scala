package com.scalableminds.brainflight.lib

import net.liftweb.mongodb.record.field.ObjectIdPk
import xml.{Text, NodeSeq}
import net.liftweb.http.{js, S}
import js._
import JsCmds._
import S._
import net.liftweb.util.Helpers._
import net.liftweb.util._
import net.liftweb.common._
import net.liftweb.record.field._
import net.liftweb.mongodb.record._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 29.10.11
 * Time: 21:21
 */

trait ProtoUser[T <: ProtoUser[T]] extends MongoRecord[T] with ObjectIdPk[T] {
  self: T =>

  def userIdAsString: String = id.toString

  object firstName extends StringField(this, 32) {
    override def displayName = ??("first.name")
  }
  /*
  object lastName extends StringField(this, 32) {
    override def displayName = ??("last.name")
  } */

  object email extends EmailField(this, 48) {
    override def displayName = ??("email.address")

    private def valUnique(msg: => String)(value: String): List[FieldError] = {
      owner.meta.findAll(name, value).filter(_.id != owner.id).map(u =>
        FieldError(this, Text(msg))
      )
    }

    override def validations =
      valUnique(?("email.already.registered")) _	::
      super.validations
  }
  /*
  object locale extends LocaleField(this) {
    override def displayName = ??("locale")
  }

  object timezone extends TimeZoneField(this) {
    override def displayName = ??("time.zone")
  }
  */
  import net.liftweb.record.field._
  class test extends PasswordField(this){

  }
  object password extends RichMongoPasswordField(this,Full(repassword)) {
	  override def displayName = ??("password")
	}
  object repassword extends StringField(this, 32) {
	  override def displayName = ?("confirm.password")
    override def ignoreField_? = true
    private def elem = S.fmapFunc(S.SFuncHolder(this.setFromAny(_))) {
      funcName =>
      <input type="password" maxlength={maxLength.toString}
        name={funcName}
        value={valueBox openOr ""}
        tabindex={tabIndex toString}/>
    }


    override def toForm: Box[NodeSeq] =
      uniqueFieldId match {
        case Full(id) => Full(elem % ("id" -> (id + "_field")))
        case _ => Full(elem)
      }
	}

  object superUser extends BooleanField(this)

  def niceName: String = (firstName.value, email.value) match {
    case (f, e) if f.length > 1 => f + " (" + e +")"
    case (_, e) => e
  }

  def shortName: String = (firstName.value) match {
    case (f) if f.length > 1 => f
    case _ => email.value
  }

  def niceNameWEmailLink = <a href={"mailto:"+email.value}>{niceName}</a>

}