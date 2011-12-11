package com.scalableminds.brainflight
package lib

import scala.xml._

import net.liftweb._
import common._
import http.NoticeType
import json._
import util.CssSel
import util.Helpers._

import org.bson.types.ObjectId

trait AppHelpers {
  /*
  * Allows for the following to be used when building snippets and it will handle
  * errors according to handleError:
  *
  *   for {
  *     user <- User.currentUser ?~ "You must be logged in to edit your profile."
  *   } yield ({
  *   ...
  *   }): NodeSeq
  */
  implicit protected def boxNodeSeqToNodeSeq(in: Box[NodeSeq]): NodeSeq = in match {
    case Full(ns) => ns
    case Failure(msg, _, _) => handleNodeSeqError(msg)
    case Empty => handleNodeSeqError("Empty snippet")
  }
  protected def handleNodeSeqError(msg: String): NodeSeq = Comment("ERROR: %s".format(msg))

  /*
  * Allows for the following to be used when building snippets and it will handle
  * errors according to handleError:
  *
  *   for {
  *     user <- User.currentUser ?~ "You must be logged in to edit your profile."
  *   } yield ({
  *   ...
  *   }): CssSel
  */
  implicit protected def boxCssSelToCssSel(in: Box[CssSel]): CssSel = in match {
    case Full(csssel) => csssel
    case Failure(msg, _, _) => handleCssSelError(msg)
    case Empty => handleCssSelError("Empty snippet")
  }
  protected def handleCssSelError(msg: String): CssSel = "*" #> Text("ERROR: %s".format(msg))

  /*
   * For use in for comprehensions
   */
  protected def boolToBox(b: Boolean): Box[Boolean] = if (b) Full(b) else Empty

  /*
   * For RestHelper API classes
   */
  implicit def boxJsonToJsonResponse(in: Box[JValue]): JValue = in match {
    case Full(jv) => jv
    case Failure(msg, _, _) => JsonAlert.error(msg).asJValue
    case Empty => JsonAlert.warning("Empty response").asJValue
  }

  case class JsonAlert(val message: String, val level: NoticeType.Value) {
    import JsonDSL._
    def asJValue: JValue = ("error" -> ("message" -> message) ~ ("level" -> level.title))
  }
  object JsonAlert {
    def info(msg: String): JsonAlert = JsonAlert(msg, NoticeType.Notice)
    def error(msg: String): JsonAlert = JsonAlert(msg, NoticeType.Error)
    def warning(msg: String): JsonAlert = JsonAlert(msg, NoticeType.Warning)
  }

  object AsObjectId {
    def unapply(in: String): Option[ObjectId] = asObjectId(in)
     private def asObjectId(in: String): Option[ObjectId] =
      if (ObjectId.isValid(in)) Some(new ObjectId(in))
      else None
  }
}
