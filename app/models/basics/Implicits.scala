package models.basics

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import models.user.User
import oxalis.security.WebknossosSilhouette.{SecuredRequest, UserAwareAction, UserAwareRequest}

import scala.language.implicitConversions


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
