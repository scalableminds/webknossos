package mcp

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC

import java.net.URI
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.util.Try

/**
  * Serves the documentation of the WEBKNOSSOS Python library to MCP clients. The docs are hosted externally, so they
  * are fetched on demand and cached for a while.
  */
@Singleton
class PythonDocsService @Inject() (rpc: RPC)(implicit ec: ExecutionContext) {

  import PythonDocsService.{docsHost, isAllowedUrl}

  private val indexUrl = s"https://$docsHost/llms.txt"

  private val cache: AlfuCache[String, String] =
    AlfuCache(maxCapacity = 200, timeToLive = 1 hour, timeToIdle = 1 hour)

  def getIndex: Fox[String] = fetch(indexUrl)

  def getPage(url: String): Fox[String] =
    for {
      _ <- Fox.fromBool(isAllowedUrl(url)) ?~> s"Only pages on https://$docsHost/ can be read. Got: $url"
      page <- fetch(url) ?~> s"Could not fetch $url"
    } yield page

  private def fetch(url: String): Fox[String] =
    cache.getOrLoad(url, urlToFetch => rpc(urlToFetch).silent.get.map(_.body))
}

object PythonDocsService {
  val docsHost = "docs.webknossos.org"

  // Guards against using this endpoint to make the server fetch arbitrary (possibly internal) URLs.
  def isAllowedUrl(url: String): Boolean =
    Try(new URI(url)).toOption.exists(uri => uri.getScheme == "https" && uri.getHost == docsHost)
}
