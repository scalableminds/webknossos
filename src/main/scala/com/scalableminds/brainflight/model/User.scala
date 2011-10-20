package com.scalableminds.brainflight.model

import _root_.net.liftweb.http.{js, S, SHtml, SessionVar, RequestVar, CleanRequestVarOnSessionTransition}
    import js._
    import JsCmds._
    import S._
    import SHtml._

    import _root_.net.liftweb.sitemap._
    import _root_.net.liftweb.sitemap.Loc._
    import _root_.net.liftweb.util.Helpers._
    import _root_.net.liftweb.util._
    import _root_.net.liftweb.common._
    import _root_.net.liftweb.util.Mailer._
    import _root_.net.liftweb.json.DefaultFormats
    import _root_.net.liftweb.json.JsonDSL._
    import _root_.net.liftweb.json.JsonAST.JObject


    import _root_.scala.xml.{NodeSeq, Node, Text, Elem}
    import _root_.scala.xml.transform._

    import _root_.com.mongodb._
    import _root_.com.mongodb.util.JSON

import _root_.net.liftweb.mongodb.record._
import _root_.net.liftweb.mongodb.record.field._
import _root_.net.liftweb.record.field._

    class ProtoUser private() extends MongoRecord[ProtoUser] with ObjectIdPk[ProtoUser] {
      def meta = ProtoUser

      object userName extends StringField(this, 32) {
        override def displayName = ??("user.name")
        override def name = "_id"
      }

      object email extends EmailField(this, 48) {
        override def displayName = ??("email.address")
      }

      object password extends PasswordField(this) {
        override def displayName = ??("password")
      }

      object superUser extends BooleanField(this)

      def niceName: String = (userName.value, email.value) match {
        case (u, e) if u.length > 1 => u + "(" + e + ")"
        case _ => email.value
      }

      def shortName: String = (userName.value, email.value) match {
        case (u, e) if u.length > 1 => u
        case _ => email.value
      }

      def niceNameWEmailLink = <a href={"mailto:"+email.value}>{niceName}</a>

      def matchPassword(toMatch : String) = {
        hash("{"+toMatch+"} salt={" + password.salt + "}") == password.value
      }
    }
    object ProtoUser extends ProtoUser with MongoMetaRecord[ProtoUser]
