/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.services.{AccessMode, AccessResourceType, UserAccessAnswer, UserAccessRequest}
import models.annotation._
import models.binary.{DataSetDAO, DataStoreHandlingStrategy}
import models.user.User
import net.liftweb.common.{Box, Full}
import oxalis.security.WebknossosSilhouette.UserAwareAction
import oxalis.security.{URLSharing, TokenType, WebknossosSilhouette}
import play.api.i18n.MessagesApi
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class UserTokenController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with WKDataStoreActionHelper
    with AnnotationInformationProvider {

  val bearerTokenService = WebknossosSilhouette.environment.combinedAuthenticatorService.tokenAuthenticatorService

  def generateTokenForDataStore = UserAwareAction.async { implicit request =>
    val context = userAwareRequestToDBAccess(request)
    val tokenFox: Fox[String] = request.identity match {
      case Some(user) =>
        bearerTokenService.createAndInit(user.loginInfo, TokenType.DataStore, deleteOld = false).toFox
      case None => Fox.successful("")
    }
    for {
      token <- tokenFox
    } yield {
      Ok(Json.obj("token" -> token))
    }
  }

  def validateUserAccess(name: String, token: String) = DataStoreAction(name).async(validateJson[UserAccessRequest]) { implicit request =>
    val accessRequest = request.body
    if (token == DataStoreHandlingStrategy.webKnossosToken) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(true))))
    } else {
      for {
        userBox <- bearerTokenService.userForToken(token)(GlobalAccessContext).futureBox
        ctxFromUserBox = DBAccessContext(userBox)
        ctx = URLSharing.fallbackTokenAccessContext(Some(token))(ctxFromUserBox)
        answer <- accessRequest.resourceType match {
          case AccessResourceType.datasource =>
            handleDataSourceAccess(accessRequest.resourceId, accessRequest.mode, userBox)(ctx)
          case AccessResourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId, accessRequest.mode, userBox)(ctx)
          case _ =>
            Fox.successful(UserAccessAnswer(false, Some("Invalid access token.")))
        }
      } yield {
        Ok(Json.toJson(answer))
      }
    }
  }


  private def handleDataSourceAccess(dataSourceName: String, mode: AccessMode.Value, userBox: Box[User])(implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {
    //Note: reading access is ensured in findOneBySourceName, depending on the implicit DBAccessContext

    def tryRead: Fox[UserAccessAnswer] = {
      DataSetDAO.findOneBySourceName(dataSourceName).futureBox map {
        case Full(_) => UserAccessAnswer(true)
        case _ => UserAccessAnswer(false, Some("No read access on dataset"))
      }
    }

    def tryWrite: Fox[UserAccessAnswer] = {
      for {
        dataset <- DataSetDAO.findOneBySourceName(dataSourceName) ?~> "datasource.notFound"
        user <- userBox.toFox
        owningOrg = dataset.owningOrganization
        isAllowed <- (user.isAdminOf(owningOrg) || user.isTeamManagerInOrg(owningOrg)).futureBox
      } yield {
        Full(UserAccessAnswer(isAllowed.isDefined))
      }
    }

    def tryAdministrate: Fox[UserAccessAnswer] = {
      userBox match {
        case Full(user) => Fox.successful(UserAccessAnswer(user.isAdmin || user.teamManagerTeams.nonEmpty))
        case _ => Fox.successful(UserAccessAnswer(false, Some("invalid access token")))
      }
    }

    mode match {
      case AccessMode.read => tryRead
      case AccessMode.write => tryWrite
      case AccessMode.administrate => tryAdministrate
      case _ => Fox.successful(UserAccessAnswer(false, Some("invalid access token")))
    }
  }

  private def handleTracingAccess(tracingId: String, mode: AccessMode.Value, userBox: Box[User])(implicit ctx: DBAccessContext): Fox[UserAccessAnswer] = {

    def findAnnotationForTracing(tracingId: String): Fox[AnnotationSQL] = {
      val annotationFox = AnnotationSQLDAO.findOneByTracingId(tracingId)
      for {
        annotationBox <- annotationFox.futureBox
      } yield {
        annotationBox match {
          case Full(_) => annotationBox
          case _ => AnnotationStore.findCachedByTracingId(tracingId)
        }
      }
    }

    def checkRestrictions(restrictions: AnnotationRestrictions) = {
      mode match {
        case AccessMode.read => restrictions.allowAccess(userBox)
        case AccessMode.write => restrictions.allowUpdate(userBox)
        case _ => Fox.successful(false)
      }
    }

    for {
      annotation <- findAnnotationForTracing(tracingId)
      restrictions <- restrictionsFor(AnnotationIdentifier(annotation.typ, annotation._id))
      allowed <- checkRestrictions(restrictions)
    } yield {
      if (allowed) UserAccessAnswer(true) else UserAccessAnswer(false, Some(s"No ${mode.toString} access to tracing"))
    }
  }
}
