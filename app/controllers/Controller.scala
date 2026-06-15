package controllers

import com.scalableminds.util.accesscontext.{AuthorizedAccessContext, DBAccessContext}
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.user.User
import play.api.libs.json.{JsReadable, JsSuccess}
import play.api.mvc.InjectedController
import play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import security.{UserAwareRequestLogging, WkEnv}

trait Controller extends InjectedController with ExtendedController with UserAwareRequestLogging with LazyLogging {

  implicit def userToDBAccess(user: User): DBAccessContext =
    AuthorizedAccessContext(user)

  implicit def userAwareRequestToDBAccess(implicit request: UserAwareRequest[WkEnv, ?]): DBAccessContext =
    DBAccessContext(request.identity)

  implicit def securedRequestToDBAccess(implicit request: SecuredRequest[WkEnv, ?]): DBAccessContext =
    DBAccessContext(Some(request.identity))
}
