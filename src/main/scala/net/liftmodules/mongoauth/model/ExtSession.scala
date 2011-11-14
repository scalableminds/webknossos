package net.liftmodules.mongoauth
package model

import field._

import java.util.{Locale, UUID}

import org.joda.time.DateTime

import net.liftweb._
import common._
import http.{Req, S}
import http.provider.HTTPCookie
import mongodb.record._
import mongodb.record.field._
import util.{Helpers, LoanWrapper}

import org.bson.types.ObjectId

class ExtSession extends MongoRecord[ExtSession] with UUIDPk[ExtSession] {
  def meta = ExtSession

  object userId extends ObjectIdField(this)
  object expires extends ExpiresField(this, meta.whenExpires)
}

object ExtSession extends ExtSession with MongoMetaRecord[ExtSession] with Loggable {
  import mongodb.BsonDSL._

  override def collectionName = "user.extsessions"

  ensureIndex((userId.name -> 1))

  // MongoAuth vars
  private lazy val whenExpires = MongoAuth.extSessionExpires.vend
  private lazy val cookieName = MongoAuth.extSessionCookieName.vend
  private lazy val cookiePath = MongoAuth.extSessionCookiePath.vend

  // create an extSession
  def createExtSession(uid: ObjectId) {
    deleteExtCookie() // make sure existing cookie is removed
    deleteAllByUserId(uid) // make sure all existing db entries are deleted
    val inst = createRecord
      .userId(uid)
      .save
    val cookie = HTTPCookie(cookieName, inst.id.value.toString)
      .setMaxAge(whenExpires.toPeriod.toStandardSeconds.getSeconds)
      .setPath(cookiePath)
    S.addCookie(cookie)
  }

  def createExtSession(uid: String) {
    if (ObjectId.isValid(uid))
      createExtSession(new ObjectId(uid))
  }

  // delete the ext cookie
  def deleteExtCookie() {
    for (cook <- S.findCookie(cookieName)) {
      S.deleteCookie(cookieName)
      logger.debug("S.deleteCookie called.")
      for {
        cv <- cook.value
        uuid <- Helpers.tryo(UUID.fromString(cv))
        extSess <- find(uuid)
      } {
        extSess.delete_!
        logger.debug("ExtSession Record deleted.")
      }
    }
  }

  def deleteAllByUserId(uid: ObjectId) {
    delete(userId.name, uid)
  }

  def handleExtSession: Box[ExtSession] = {
    val extSess = for {
      cookie <- S.findCookie(cookieName) // empty means we should ignore it
      cookieValue <- cookie.value ?~ "Cookie value is empty"
      uuid <- Helpers.tryo(UUID.fromString(cookieValue)) ?~ "Invalid UUID"
      es <- find(uuid) ?~ "ExtSession not found: %s".format(uuid.toString)
    } yield es

    extSess match {
      case Failure(msg, _, _) => deleteExtCookie(); extSess // cookie is not valid, delete it
      case Full(es) if (es.expires.isExpired) => // if it's expired, delete it and the cookie
        extSess.foreach(_.delete_!)
        deleteExtCookie()
        Failure("Extended session has expired")
      case _ => extSess
    }
  }
}
