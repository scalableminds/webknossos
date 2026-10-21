package mcp

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.rpc.RPC

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt

/**
  * Serves the EM-Skills collection (https://github.com/yanchaoz/EM-Skills) to MCP clients: agent skills for volume
  * electron microscopy processing, such as neuron and mitochondria segmentation, annotation planning and review.
  * They pair with the WEBKNOSSOS Python library, which is how the data gets in and out.
  *
  * The skills are fetched from the repository rather than bundled, so that they stay up to date and so that
  * WEBKNOSSOS does not redistribute third-party code.
  */
@Singleton
class EmSkillsService @Inject() (rpc: RPC)(implicit ec: ExecutionContext) {

  import EmSkillsService.{isValidSkillName, rawBaseUrl, repositoryUrl}

  private val cache: AlfuCache[String, String] = AlfuCache(maxCapacity = 50, timeToLive = 1 hour, timeToIdle = 1 hour)

  def getCatalogue: Fox[String] = fetch(s"$rawBaseUrl/README.md")

  def getSkill(name: String): Fox[String] =
    for {
      _ <- Fox.fromBool(isValidSkillName(name)) ?~> s"Not a valid skill name: $name. See $repositoryUrl"
      skill <- fetch(s"$rawBaseUrl/skills/$name/SKILL.md") ?~> s"Could not find the skill $name. See $repositoryUrl"
    } yield skill

  private def fetch(url: String): Fox[String] =
    cache.getOrLoad(url, urlToFetch => rpc(urlToFetch).silent.get.map(_.body))
}

object EmSkillsService {
  val repositoryUrl = "https://github.com/yanchaoz/EM-Skills"
  private val rawBaseUrl = "https://raw.githubusercontent.com/yanchaoz/EM-Skills/main"

  // The name becomes part of a URL under a fixed prefix, so it must not be able to escape that prefix.
  def isValidSkillName(name: String): Boolean = name.matches("^[a-z0-9][a-z0-9-]{0,63}$")
}
