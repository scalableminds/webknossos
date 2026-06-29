package controllers

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.mvc.ExtendedController
import play.api.mvc.InjectedController
import play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import security.{UserAwareRequestLogging, WkEnv}

trait Controller extends InjectedController with ExtendedController with UserAwareRequestLogging {

  implicit def userAwareRequestToDBAccess(implicit request: UserAwareRequest[WkEnv, ?]): DBAccessContext =
    DBAccessContext(request.identity)

  implicit def securedRequestToDBAccess(implicit request: SecuredRequest[WkEnv, ?]): DBAccessContext =
    DBAccessContext(Some(request.identity))

}
