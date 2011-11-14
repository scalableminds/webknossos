package net.liftmodules.mongoauth
package field

import java.util.regex._
import scala.xml._

import org.mindrot.jbcrypt.BCrypt

import net.liftweb._
import common._
import http.{Factory, S}
import http.js._
import json.JsonAST.{JNothing, JNull, JString, JValue}
import mongodb.record.field._
import mongodb.record._
import net.liftweb.record._
import net.liftweb.record.field._
import util._
import Helpers._
import JE._

/*
 * Hashed password structure:
 * <salt><encrypted-pwd>
 * Where salt is:
 * $2a$<logRounds><salt-value>
 * Salt length: 29
 * Total length: 60
 */

object PasswordField extends Factory with Loggable {

  val logRounds = new FactoryMaker[Int](10) {}

  def hashpw(in: String): Box[String] =
    tryo(BCrypt.hashpw(in, BCrypt.gensalt(logRounds.vend)))

  /*
   * jBCrypt throws "String index out of range" exception
   * if password is an empty String
   */
  def isMatch(toTest: String, encryptedPassword: String): Boolean =
    if (toTest.length > 0 && encryptedPassword.length > 0)
      tryo(BCrypt.checkpw(toTest, encryptedPassword)).openOr(false)
    else
      false
}

trait PasswordTypedField extends TypedField[String] {
  def maxLength: Int
  def minLength: Int

  /*
   * Call this after validation and before it is saved to the db to hash
   * the password. Eg. in the finish method of a screen.
   */
  def hashIt: Unit = valueBox foreach { v =>
    setBox(PasswordField.hashpw(v))
  }

  def isMatch(toTest: String): Boolean = valueBox
    .map(p => PasswordField.isMatch(toTest, p))
    .openOr(false)

  def elem = S.fmapFunc(S.SFuncHolder(this.setFromAny(_))) {
    funcName => <input type="password" maxlength={maxLength.toString}
      name={funcName}
      value={valueBox openOr ""}
      tabindex={tabIndex toString}/>}

  override def toForm: Box[NodeSeq] =
    uniqueFieldId match {
      case Full(id) => Full(elem % ("id" -> id))
      case _ => Full(elem)
    }
}

class PasswordField[OwnerType <: Record[OwnerType]](
  rec: OwnerType, val minLength: Int, maxLength: Int
)
extends StringField[OwnerType](rec, maxLength) with PasswordTypedField {

	/*
	 * Use this when creating users programatically. It allows chaining:
	 * User.createRecord.email("test@domain.com").password("pass1", true).save
	 * This will automatically hash the plain text password if isPlain is
	 * true.
	 */
	def apply(in: String, isPlain: Boolean): OwnerType = {
    val hashed =
      if (isPlain)
        PasswordField.hashpw(in) openOr ""
      else
        in
    if (owner.meta.mutable_?) {
      this.setBox(Full(hashed))
      owner
    } else {
      owner.meta.createWithMutableField(owner, this, Full(hashed))
    }
  }
}
