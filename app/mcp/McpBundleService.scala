package mcp

import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.*
import utils.WkConf

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.zip.{ZipEntry, ZipOutputStream}
import javax.inject.{Inject, Singleton}
import scala.io.Source
import scala.util.Using

/**
  * Builds the MCP Bundle (.mcpb) for this instance, which users can download and install into Claude Desktop and
  * other MCPB hosts with a double click.
  *
  * A bundle is a zip of a manifest.json and a local MCP server. Since MCPB cannot describe a remote server, the
  * bundled server is the thin stdio-to-HTTP bridge in conf/mcpb/index.js, and the manifest points it at this
  * instance. Generating the bundle here rather than shipping a static file means the URL of this instance and the
  * list of tools are always in sync with what the server actually offers.
  */
@Singleton
class McpBundleService @Inject() (mcpService: McpService, conf: WkConf) extends LazyLogging {

  val fileName = "webknossos.mcpb"

  private val bridgeResourcePath = "/mcpb/index.js"

  // The manifest version must be semver, while the WEBKNOSSOS version is a release tag, a CI build number or "dev".
  private val semverPattern = """^(\d+\.\d+\.\d+).*""".r

  lazy val bundleBytes: Array[Byte] = build()

  def warmUp(): Unit =
    try
      logger.info(s"Generated MCP bundle $fileName (${bundleBytes.length} bytes) for ${mcpUrl}")
    catch
      case e: Exception => logger.error(s"Could not generate the MCP bundle: ${e.getMessage}", e)

  private def mcpUrl: String = s"${conf.Http.uri.stripSuffix("/")}/api/mcp"

  private def manifestVersion: String = webknossos.BuildInfo.version match {
    case semverPattern(version) => version
    case _                      => "0.0.0"
  }

  private def build(): Array[Byte] = {
    val bridgeSource = Using.resource(getClass.getResourceAsStream(bridgeResourcePath)) { stream =>
      if (stream == null) throw new Exception(s"Could not find $bridgeResourcePath on the classpath")
      Source.fromInputStream(stream, StandardCharsets.UTF_8.name).mkString
    }
    val out = new ByteArrayOutputStream()
    Using.resource(new ZipOutputStream(out)) { zip =>
      addEntry(zip, "manifest.json", Json.prettyPrint(manifest))
      addEntry(zip, "server/index.js", bridgeSource)
    }
    out.toByteArray
  }

  private def addEntry(zip: ZipOutputStream, name: String, content: String): Unit = {
    val entry = new ZipEntry(name)
    entry.setTime(fixedEntryTime) // so that the same build yields the same bytes
    zip.putNextEntry(entry)
    zip.write(content.getBytes(StandardCharsets.UTF_8))
    zip.closeEntry()
  }

  // 2000-01-01, an arbitrary fixed date. Zip entries cannot express dates before 1980.
  private val fixedEntryTime: Long = 946684800000L

  private def manifest: JsObject = Json.obj(
    "manifest_version" -> "0.3",
    "name" -> "webknossos",
    "display_name" -> "WEBKNOSSOS",
    "version" -> manifestVersion,
    "description" -> "Work with WEBKNOSSOS datasets and annotations through the WEBKNOSSOS Python library.",
    "long_description" ->
      """Connects your AI assistant to a WEBKNOSSOS instance. It provides a short-lived API token for the
        |signed-in user and the documentation of the WEBKNOSSOS Python library, so that the assistant can write
        |and run Python code against your datasets and annotations instead of calling the HTTP API by hand.""".stripMargin,
    "author" -> Json.obj("name" -> "scalable minds", "url" -> "https://scalableminds.com"),
    "homepage" -> "https://webknossos.org",
    "documentation" -> "https://docs.webknossos.org",
    "support" -> "https://github.com/scalableminds/webknossos/issues",
    "repository" -> Json.obj("type" -> "git", "url" -> "https://github.com/scalableminds/webknossos"),
    "license" -> "AGPL-3.0",
    "keywords" -> Json.arr("webknossos", "microscopy", "connectomics", "neuroscience", "annotation"),
    "server" -> Json.obj(
      "type" -> "node",
      "entry_point" -> "server/index.js",
      "mcp_config" -> Json.obj(
        "command" -> "node",
        "args" -> Json.arr("${__dirname}/server/index.js"),
        "env" -> Json.obj(
          "WK_MCP_URL" -> "${user_config.url}",
          "WK_AUTH_TOKEN" -> "${user_config.token}"
        )
      )
    ),
    "tools" -> manifestTools,
    "tools_generated" -> false,
    "user_config" -> Json.obj(
      "url" -> Json.obj(
        "type" -> "string",
        "title" -> "WEBKNOSSOS MCP URL",
        "description" -> "The MCP endpoint of your WEBKNOSSOS instance",
        "required" -> true,
        "default" -> mcpUrl
      ),
      "token" -> Json.obj(
        "type" -> "string",
        "title" -> "Auth Token",
        "description" -> "Your WEBKNOSSOS API token, from Account Settings > Developer > Auth Token",
        "required" -> true,
        "sensitive" -> true
      )
    ),
    "compatibility" -> Json.obj(
      "platforms" -> Json.arr("darwin", "win32", "linux"),
      "runtimes" -> Json.obj("node" -> ">=18.0.0")
    )
  )

  // The manifest lists the tools for display in the host app, so the short title is the better description here.
  private def manifestTools: JsArray =
    JsArray(mcpService.tools.value.map { tool =>
      Json.obj("name" -> (tool \ "name").as[String], "description" -> (tool \ "title").as[String])
    })
}
