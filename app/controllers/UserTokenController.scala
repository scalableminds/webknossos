/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import oxalis.security.WebknossosSilhouette.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import com.scalableminds.webknossos.datastore.services.{AccessMode, AccessResourceType, UserAccessAnswer, UserAccessRequest}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import models.annotation._
import models.binary.DataSetDAO
import models.user.{User, UserToken, UserTokenDAO, UserTokenService}
import net.liftweb.common.{Box, Full}
import play.api.i18n.MessagesApi
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class UserTokenController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with WKDataStoreActionHelper
    with AnnotationInformationProvider {

  val webKnossosToken = play.api.Play.current.configuration.getString("application.authentication.dataStoreToken").getOrElse("somethingSecure")

  def generateUserToken = UserAwareAction.async { implicit request =>
    val context = userAwareRequestToDBAccess(request)

    val tokenFox: Fox[String] = request.identity match {
      case Some(user) =>
        val token = UserToken(user._id)
        UserTokenDAO.insert(token).map(_ => token.token)
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
    if (token == webKnossosToken) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(true))))
    } else {
      for {
        userBox <- UserTokenService.userForToken(token)(GlobalAccessContext).futureBox
        ctx = DBAccessContext(userBox)
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
        isAllowed <- user.isAdminOf(owningOrg).futureBox
      } yield {
        Full(UserAccessAnswer(isAllowed.isDefined))
      }
    }

    def tryAdministrate: Fox[UserAccessAnswer] = {
      userBox match {
        case Full(user) => Fox.successful(UserAccessAnswer(user.isAdmin))
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

    def findAnnotationForTracing(tracingId: String): Fox[Annotation] = {
      val annotationFox = AnnotationDAO.findByTracingId(tracingId)
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
        case _ => false
      }
    }

    for {
      annotation <- findAnnotationForTracing(tracingId)
      restrictions <- restrictionsFor(AnnotationIdentifier(annotation.typ, annotation.id))
      allowed = checkRestrictions(restrictions)
    } yield {
      if (allowed) UserAccessAnswer(true) else UserAccessAnswer(false, Some(s"No ${mode.toString} access to tracing"))
    }
  }
}
