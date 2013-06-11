package models.basics

import oxalis.security.AuthenticatedRequest
import models.user.User

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 01:11
 */
object Implicits extends Implicits

trait Implicits {
  implicit def authedRequestToDBAccess(implicit request: AuthenticatedRequest[_]): DBAccessContext = {
    AuthedAccessContext(request.user)
  }

  implicit def userToDBAccess(user: User): DBAccessContext = {
    AuthedAccessContext(user)
  }
}
