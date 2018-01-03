/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github

import com.scalableminds.util.github.models.LinkHeader
import com.scalableminds.util.github.requesters.GithubRequester
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Reads
import play.api.libs.ws.WSRequest

import scala.concurrent.Future

class ResultSet[T](requestUrl: String, deserializer: Reads[T], token: String) extends GithubRequester with LazyLogging {

  def parseParams(rawParams: List[String]): Map[String, String] = {
    val ParamRx = """^\s*([^=]*)\s*=\s*"(.*?)"\s*$""".r
    rawParams.flatMap {
      case ParamRx(typ, value) =>
        Some(typ -> value)
      case _ =>
        None
    }.toMap
  }

  def parseLinkHeader(linkHeader: String): Array[LinkHeader] = {
    linkHeader.split(",").flatMap {
      link =>
        link.split(";").toList match {
          case url :: rawParams =>
            val params = parseParams(rawParams)
            Some(LinkHeader(url.drop(1).dropRight(1), params))
          case _ =>
            None
        }
    }
  }

  def isNextHeader(header: LinkHeader): Boolean = {
    header.params.get("rel").contains("next")
  }

  def results: Future[List[T]] = {
    def requestNext(nextRequest: WSRequest): Future[List[T]] = {
      nextRequest.get().flatMap {
        response =>
          val result = response.json.validate(deserializer).asOpt.toList

          if (response.status != Status.OK) {
            logger.warn("Result in result set failed: " + response.json)
          }
          response.header("Link").flatMap(h => parseLinkHeader(h).find(isNextHeader)) match {
            case Some(link) =>
              requestNext(githubRequest(link.value, prependHost = false)(token)).map(result ::: _)
            case _ =>
              Future.successful(result)
          }
      }

    }
    requestNext(githubRequest(requestUrl)(token))
  }
}
