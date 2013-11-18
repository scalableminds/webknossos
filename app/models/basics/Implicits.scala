package models.basics

import oxalis.security.{UserAwareRequest, AuthenticatedRequest}
import models.user.User
import braingames.reactivemongo.{DBAccessContext, AuthedAccessContext}
import com.mongodb.casbah.Imports._
import braingames.reactivemongo.AuthedAccessContext
import reactivemongo.bson.BSONObjectID

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 01:11
 */
object Implicits extends Implicits

trait Implicits {
  implicit def authedRequestToDBAccess(implicit request: UserAwareRequest[_]): DBAccessContext = {
    DBAccessContext(request.userOpt)
  }

  implicit def userToDBAccess(user: User): DBAccessContext = {
    AuthedAccessContext(user)
  }

  implicit def toBSONObjectID(o: ObjectId) =
    BSONObjectID(o.toString)

  implicit def toObjectID(o: BSONObjectID) =
    new ObjectId(o.stringify)
}
