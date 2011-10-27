package com.scalableminds.brainflight.model

import _root_.scala.xml.{NodeSeq, Node, Text, Elem}
import net.liftweb.mongodb.record.field._
import net.liftweb.record.Field
import net.liftweb.common._
import _root_.net.liftweb.http.{S, js, SHtml}
import js._
import JsCmds._
import _root_.scala.xml.{NodeSeq, Node, Text, Elem}
import _root_.scala.xml.transform._
import _root_.net.liftweb.sitemap._
import _root_.net.liftweb.sitemap.Loc._
import _root_.net.liftweb.util.Helpers._
import _root_.net.liftweb.util._
import _root_.net.liftweb.common._
import _root_.net.liftweb.util.Mailer._
import S._
import _root_.net.liftweb.proto.{ProtoUser => GenProtoUser}
import net.liftweb.mongodb.record.{MongoRecord, MongoId, MongoMetaRecord}
import net.liftweb.mongodb._
import _root_.net.liftweb.json.DefaultFormats
import _root_.net.liftweb.json.JsonDSL._
import _root_.net.liftweb.json.JsonAST.JObject

import net.liftweb.record.field._

trait UserIdAsString {
  def userIdAsString: String
}
/**
* ProtoUser is a base class that gives you a "User" that has a first name,
* last name, email, etc.
*/
trait ProtoUser[T <: ProtoUser[T]] extends MongoRecord[T] with UserIdAsString with MongoId[T]{
  self: T =>

  /**
* The primary key field for the User. You can override the behavior
* of this field:
* <pre name="code" class="scala">
* override lazy val id = new MyMappedLongClass(this) {
* println("I am doing something different")
* }
* </pre>
*/

  protected class MyMappedLongClass(obj: T) extends LongField(obj)

  /**
* Convert the id to a String
*/
  def userIdAsString: String = _id.is.toString

  object firstName extends StringField(this,32){
    override def displayName = ??("first.name")
  }
  /*
  object lastName extends StringField(this,32){
    override def displayName = ??("last.name")
  }*/

  object email extends EmailField(this, 48) {
    private def valUnique(emailValue: ValueType): List[FieldError] =
    toBoxMyType(emailValue) match {
      case Full(email) => {
        owner.meta.findAll("email", email) match {
          case Nil => Nil
          case usr :: Nil if (usr.id == owner.id) => Empty
          case _ => Text(S.??("unique.email.address"))
        }
      }
      case _ => Text(S.??("unique.email.address"))
    }

    override def displayName = ??("email.address")
    override def validations = valUnique _ :: super.validations
  }


  object password extends MongoPasswordField(this) {

    private var invalidMatch = false

    override def displayName = ??("password")

    override def validate: List[FieldError] =
      if(invalidMatch) Text(S.??("passwords.do.not.match"))
      else runValidation(validatorValue)

    def setMyPassword(l: List[String]) =
      if (l.length == 2 && l.head == l(1)){
        invalidMatch = false
        this.set(Password(l.head))
      }
      else
        invalidMatch = true

    private def elem = S.fmapFunc({s: List[String] => this.setMyPassword(s)}) {
      funcName =>
         <span>
            <input type='password' name={funcName} value=""/>
            &nbsp;{S.??("repeat")}&nbsp;
            <input type='password' name={funcName} value=""/>
          </span>
    }

    override def toForm: Box[NodeSeq] =
      uniqueFieldId match {
        case Full(id) => Full(elem % ("id" -> (id+"_field")))
        case _ => Full(elem)
      }
  }
  /*
  lazy val superUser: BooleanField[T] = new MySuperUser(this)

  protected class MySuperUser(obj: T) extends BooleanField(obj) {
    override def defaultValue = false
  }*/

  def niceName: String = (firstName.is, email.is) match {
    case (f, e) if f.length > 1 => f + "("+e+")"
    case (_, e) => e
  }

  def shortName: String = (firstName.is) match {
    case (f) if f.length > 1 => f
    case _ => email.is
  }

  def niceNameWEmailLink = <a href={"mailto:"+email.is}>{niceName}</a>
}

trait MetaMegaProtoUser[ModelType <: MegaProtoUser[ModelType]] extends MongoMetaRecord[ModelType] with MongoId[ModelType] with GenProtoUser {
  self: ModelType =>

  type TheUserType = ModelType
  //ensureIndex(("email" -> 1), true) // unique email
  /**
* What's a field pointer for the underlying CRUDify
*/
  type FieldPointerType = Field[_, TheUserType]

  /**
* Based on a FieldPointer, build a FieldPointerBridge
*/
  protected implicit def buildFieldBridge(from: FieldPointerType): FieldPointerBridge = new MyPointer(from)


  protected class MyPointer(from: FieldPointerType) extends FieldPointerBridge {
    /**
* What is the display name of this field?
*/
    def displayHtml: NodeSeq = from.displayHtml

    /**
* Does this represent a pointer to a Password field
*/
    def isPasswordField_? : Boolean = from match {
      case a: MongoPasswordField[_] => true
      case _ => false
    }
  }

  /**
* Convert an instance of TheUserType to the Bridge trait
*/
  protected implicit def typeToBridge(in: TheUserType): UserBridge =
    new MyUserBridge(in)

  /**
* Bridges from TheUserType to methods used in this class
*/
  protected class MyUserBridge(in: TheUserType) extends UserBridge {
    /**
* Convert the user's primary key to a String
*/
    def userIdAsString: String = in.id.toString

    /**
* Return the user's first name
*/
    def getFirstName: String = in.firstName.is

    /**
* Return the user's last name
*/
    def getLastName: String = ""

    /**
* Get the user's email
*/
    def getEmail: String = in.email.is

    /**
* Is the user a superuser
*/  //TODO: Ugly
    def superUser_? : Boolean = false

    /**
* Has the user been validated?
*/
    def validated_? : Boolean = in.validated.is

    /**
* Does the supplied password match the actual password?
*/
    def testPassword(toTest: Box[String]): Boolean =
      toTest.map(in.password.isMatch) openOr false

    /**
* Set the validation flag on the user and return the user
*/
    def setValidated(validation: Boolean): TheUserType =
      in.validated(validation)

    /**
* Set the unique ID for this user to a new value
*/
    //TODO
    def resetUniqueId(): TheUserType = {
      in
    }

    /**
* Return the unique ID for the user
*/
    def getUniqueId(): String = in._id.toString

    /**
* Validate the user
*/
    def validate: List[FieldError] = in.validate

    /**
* Given a list of string, set the password
*/
    def setPasswordFromListString(pwd: List[String]): TheUserType = {
      pwd match {
        case x1 :: x2 :: Nil if x1 == x2 => in.password.setPassword(x1)
        case _ => Nil
      }
      in
    }

    /**
* Save the user to backing store
*/
    def save(): Boolean = {
      in.save(true)
      true
    }
  }

  /**
* Given a field pointer and an instance, get the field on that instance
*/
  protected def computeFieldFromPointer(instance: TheUserType, pointer: FieldPointerType): Box[BaseField] = {
    //println(instance.fieldByName(pointer.name))
    instance.fieldByName(pointer.name)
  }


  /**
* Given an firstName (probably email address), find the user
*/
  protected def findUserByEmail(email: String): Box[TheUserType] = {
    var searchListHeadOption = meta.findAll(("email" -> email)).headOption
    searchListHeadOption match {
      case Some(x) => Full(x)
      case None => return Empty
    }
  }

  protected def findUserByUserName(email: String): Box[TheUserType] = findUserByEmail(email)

  /**
* Given a unique id, find the user
*/
  protected def findUserByUniqueId(id: String): Box[TheUserType] = {
    var searchListHeadOption = meta.findAll(("_id" -> id)).headOption
    searchListHeadOption match {
      case Some(x) => Full(x)
      case None => return Empty
    }
  }

  /**
* Create a new instance of the User
*/
  protected def createNewUserInstance(): TheUserType = createRecord

  /**
* Given a String representing the User ID, find the user
*/
  protected def userFromStringId(id: String): Box[TheUserType] = find(id)

  /**
* The list of fields presented to the user at sign-up
*/
  def signupFields: List[FieldPointerType] = List(firstName,
                                     //             lastName,
                                                  email,
                                     //             locale,
                                     //             timezone,
                                                  password)

  /**
* The list of fields presented to the user for editing
*/
  def editFields: List[FieldPointerType] = List(firstName,
                                      //          lastName,
                                                email)
                                      //          locale,
                                      //          timezone)

}
/**
* ProtoUser is bare bones. MetaProtoUser contains a bunch
* more fields including a validated flag, locale, timezone, etc.
*/
trait MegaProtoUser[T <: MegaProtoUser[T]] extends ProtoUser[T]{
  self: T =>

  /**
* The user has been validated.

  object validated extends BooleanField(this){
    override def defaultValue = false
    override def displayName = ??("validated")
  }
*/
  lazy val validated: BooleanField[T] = new MyValidated(this)

  protected class MyValidated(obj: T) extends BooleanField(obj) {
    override def defaultValue = false
    override val fieldId = Some(Text("txtValidated"))
  }
  /**
* The locale field for the User.
*/
  //object locale extends LocaleField(this) {
  //  override def displayName = ??("locale")
  //}

  /**
* The time zone field for the User.
*/
  /*
  object timezone extends TimeZoneField(this) {
    override def displayName = ??("time.zone")
    //override val fieldId = Some(Text("txtTimeZone"))
  }
  */
}