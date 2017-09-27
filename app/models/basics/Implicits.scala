package models.basics

import scala.language.implicitConversions

import oxalis.security.silhouetteOxalis.UserAwareRequest
import models.user.User
import com.scalableminds.util.reactivemongo.{AuthorizedAccessContext, DBAccessContext}
import oxalis.security.silhouetteOxalis.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}

import javax.inject.Inject

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 01:11
 */
object Implicits extends Implicits

trait Implicits {
  implicit def userAwareRequestToDBAccess(implicit request: UserAwareRequest[_]): DBAccessContext = {
    DBAccessContext(request.identity)
  }

  implicit def securedRequestToDBAccess(implicit request: SecuredRequest[_]): DBAccessContext = {
    DBAccessContext(Some(request.identity))
  }
  //implicit causes ambiguous implicit values
  def securedRequestToUserAwareRequest[B](implicit request: SecuredRequest[B]): UserAwareRequest[B] = {
    val user = request.identity
    val authenticator = request.authenticator
    val initialRequest = request.request
    UserAwareRequest[B](Some(user), Some(authenticator), initialRequest)
  }

  implicit def userToDBAccess(user: User): DBAccessContext = {
    AuthorizedAccessContext(user)
  }
}
