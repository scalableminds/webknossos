/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Failure, Full}
import oxalis.ndstore.NDChannels.NDChannelsReads
import play.api.Play.current
import play.api.http.Status
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.api.libs.ws.{WS, WSResponse}

object NDServerConnection extends FoxImplicits with LazyLogging {

  val ndInfoResponseReads =
    ((__ \ 'dataset).read[NDDataSet] and
      (__ \ 'channels).read(NDChannelsReads)).tupled

  def requestProjectInformationFromNDStore(
    server: String,
    name: String,
    token: String)(implicit messages: Messages): Fox[NDProject] = {

    val normalizedServer = server.stripSuffix("/")
    val infoUrl = infoUrlFor(normalizedServer, token)

    try {
      WS.url(infoUrl).get().map { response =>
        try {
          evaluateNDServerInfoResponse(response, normalizedServer, name, token)
        } catch {
          case e: com.fasterxml.jackson.core.JsonParseException =>
            Failure(Messages("ndstore.response.parseFailure"))
          case e: Exception                                     =>
            logger.error("Exception while trying to access ndstore. " + e.getMessage)
            e.printStackTrace()
            Failure(Messages("ndstore.response.parseFailure"))
        }
      }
    } catch {
      case e: Exception =>
        logger.error(s"Exception while trying to access '$infoUrl': ${e.getMessage}")
        Failure(Messages("ndstore.unreachable"))
    }
  }

  private def infoUrlFor(server: String, token: String) = {
    import com.netaporter.uri.dsl._
    (server / "nd" / "ca" / token / "info" / "").toString
  }

  private def evaluateNDServerInfoResponse(
    response: WSResponse,
    server: String,
    name: String,
    token: String)(implicit messages: Messages) = {

    if (response.status == Status.OK) {
      response.json.validate(ndInfoResponseReads) match {
        case JsSuccess((dataset, channels), _) =>
          Full(NDProject(server, name, token, dataset, channels))
        case e: JsError                        =>
          logger.error(e.toString)
          Failure(Messages("ndstore.response.parseFailure"))
      }
    } else if(response.status == Status.NOT_FOUND) {
      fuzzyErrorParser(response.body)
    } else {
      Failure(Messages("ndstore.invalid.response", response.statusText))
    }
  }

  private def fuzzyErrorParser(response: String)(implicit messages: Messages) = {
    def isTokenError(s: String) = {
      s.startsWith("Token") && s.endsWith("does not exist")
    }

    if(isTokenError(response))
      Failure(Messages("ndstore.invalid.token"))
    else
      Failure(Messages("ndstore.invalid.response", response))
  }
}
