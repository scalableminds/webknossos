package mcp

import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.Fox
import models.user.User
import play.api.libs.json.*
import security.ShortLivedTokenService
import utils.WkConf

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

/** Implements the parts of the Model Context Protocol (MCP) that a stateless, tools-only server needs. The transport
  * (Streamable HTTP without server-to-client streaming) lives in McpController.
  */
@Singleton
class McpService @Inject() (
    shortLivedTokenService: ShortLivedTokenService,
    pythonDocsService: PythonDocsService,
    conf: WkConf
)(implicit ec: ExecutionContext)
    extends Formatter {

  private val latestProtocolVersion = "2025-06-18"
  private val supportedProtocolVersions = Set("2024-11-05", "2025-03-26", latestProtocolVersion)

  private val getTokenToolName = "get_short_lived_api_token"
  private val listDocsToolName = "list_python_library_docs"
  private val readDocsToolName = "read_python_library_docs_page"

  private val emptySchema = Json.obj("type" -> "object", "properties" -> Json.obj())

  // Also used to describe the tools in the MCP bundle manifest, see McpBundleService.
  val tools: JsArray = Json.arr(
    Json.obj(
      "name" -> getTokenToolName,
      "title" -> "Get a short-lived WEBKNOSSOS API token",
      "description" ->
        s"""Creates a short-lived API token for the current WEBKNOSSOS user, to be used with the `webknossos` Python
           |library. The token has the same permissions as the user and expires
           |after ${formatDuration(conf.Silhouette.TokenAuthenticator.shortLivedExpiry)}. Returns the token together
           |with the URL of this WEBKNOSSOS instance and the user's organization id.
           |
           |Call this before writing or running any code that talks to WEBKNOSSOS. Do not call the WEBKNOSSOS HTTP
           |API directly (no requests/httpx/curl), use the `webknossos` Python library instead.
           |
           |Write the code to a file and run it with uv, which installs the library into a temporary environment,
           |so that nothing has to be installed up front and the project's dependencies stay untouched:
           |
           |    # analysis.py
           |    import os
           |    import webknossos as wk
           |
           |    with wk.webknossos_context(url="<webknossosUrl>", token=os.environ["WK_TOKEN"]):
           |        dataset = wk.Dataset.open_remote("my-dataset")
           |
           |    $$ WK_TOKEN=<token> uv run --with webknossos analysis.py
           |
           |Keep the token out of the script file, as shown above. If uv is not available, fall back to installing
           |the `webknossos` package into a virtual environment with pip.
           |""".stripMargin,
      "inputSchema" -> emptySchema
    ),
    Json.obj(
      "name" -> listDocsToolName,
      "title" -> "List the WEBKNOSSOS Python library documentation",
      "description" ->
        """Returns the index of the `webknossos` Python library documentation (llms.txt), a list of links to the
          |documentation pages of the individual modules. Consult this before writing `webknossos` Python code, and
          |then read the relevant pages with the read_python_library_docs_page tool. Run the resulting code with
          |`uv run --with webknossos <script>.py`.""".stripMargin,
      "inputSchema" -> emptySchema
    ),
    Json.obj(
      "name" -> readDocsToolName,
      "title" -> "Read a page of the WEBKNOSSOS Python library documentation",
      "description" ->
        """Returns the markdown content of one documentation page of the `webknossos` Python library. Pass a URL as
          |listed by the list_python_library_docs tool, for example
          |https://docs.webknossos.org/api/webknossos/dataset/dataset.md""".stripMargin,
      "inputSchema" -> Json.obj(
        "type" -> "object",
        "properties" -> Json.obj(
          "url" -> Json.obj(
            "type" -> "string",
            "description" -> "URL of the documentation page, must be on https://docs.webknossos.org/"
          )
        ),
        "required" -> Json.arr("url")
      )
    )
  )

  private val instructions =
    """This server gives access to a WEBKNOSSOS instance. Work with its datasets and annotations through the
      |`webknossos` Python library.
      |
      |1. Call get_short_lived_api_token to get a token, the instance URL and the organization id.
      |2. Look up the library's API with list_python_library_docs and read_python_library_docs_page instead of
      |   guessing it.
      |3. Write the code to a file and run it with uv, which installs the library into a temporary environment:
      |   `uv run --with webknossos <script>.py`. There is no separate installation step, and the project's own
      |   dependencies are not touched. Pass the token via an environment variable rather than writing it into
      |   the script.""".stripMargin

  /** Handles one JSON-RPC message. Returns None for notifications, which must not be answered.
    */
  def handle(body: JsValue, user: User): Future[Option[JsObject]] =
    JsonRpc.parseRequest(body) match {
      case Left(parseError) => Future.successful(Some(JsonRpc.error(None, parseError)))
      case Right(request)   =>
        handleRequest(request, user).map { outcome =>
          if (request.isNotification) None
          else
            Some(outcome match {
              case Left(error)  => JsonRpc.error(request.id, error)
              case Right(value) => JsonRpc.result(request.id, value)
            })
        }
    }

  private def handleRequest(request: JsonRpcRequest, user: User): Future[Either[JsonRpcError, JsValue]] =
    request.method match {
      case "initialize"                     => Future.successful(Right(initializeResult(request.params)))
      case "ping"                           => Future.successful(Right(Json.obj()))
      case "tools/list"                     => Future.successful(Right(Json.obj("tools" -> tools)))
      case "tools/call"                     => callTool(request.params, user)
      case method if isNotification(method) => Future.successful(Right(Json.obj()))
      case method                           => Future.successful(Left(JsonRpcError.methodNotFound(method)))
    }

  private def isNotification(method: String): Boolean = method.startsWith("notifications/")

  private def initializeResult(params: JsObject): JsObject = {
    val requestedVersion = (params \ "protocolVersion").asOpt[String]
    val protocolVersion = requestedVersion.filter(supportedProtocolVersions.contains).getOrElse(latestProtocolVersion)
    Json.obj(
      "protocolVersion" -> protocolVersion,
      "capabilities" -> Json.obj("tools" -> Json.obj()),
      "serverInfo" -> Json.obj("name" -> "webknossos", "version" -> webknossos.BuildInfo.version),
      "instructions" -> instructions
    )
  }

  private def callTool(params: JsObject, user: User): Future[Either[JsonRpcError, JsValue]] =
    (params \ "name").asOpt[String] match {
      case None       => Future.successful(Left(JsonRpcError.invalidParams("Missing or invalid field: name")))
      case Some(name) =>
        val arguments = (params \ "arguments").asOpt[JsObject].getOrElse(Json.obj())
        name match {
          case `getTokenToolName` => asToolResult(Fox.successful(shortLivedTokenFor(user)))
          case `listDocsToolName` => asToolResult(pythonDocsService.getIndex)
          case `readDocsToolName` =>
            (arguments \ "url").asOpt[String] match {
              case None      => Future.successful(Left(JsonRpcError.invalidParams("Missing or invalid argument: url")))
              case Some(url) => asToolResult(pythonDocsService.getPage(url))
            }
          case _ => Future.successful(Left(JsonRpcError.invalidParams(s"Unknown tool: $name")))
        }
    }

  private def shortLivedTokenFor(user: User): String = {
    val token = shortLivedTokenService.create(user._id, conf.Silhouette.TokenAuthenticator.shortLivedExpiry)
    Json.prettyPrint(
      Json.obj(
        "token" -> token.value,
        "expiresAt" -> token.expiresAt.toString,
        "webknossosUrl" -> conf.Http.uri,
        "organizationId" -> user._organization,
        "usage" -> Json.obj(
          "python" ->
            s"""import os, webknossos as wk
               |with wk.webknossos_context(url="${conf.Http.uri}", token=os.environ["WK_TOKEN"]):
               |    dataset = wk.Dataset.open_remote("my-dataset")""".stripMargin,
          "runCommand" -> s"WK_TOKEN=${token.value} uv run --with webknossos <script>.py",
          "note" -> ("Use the `webknossos` Python library, not the WEBKNOSSOS HTTP API. Running the script with " +
            "uv installs the library into a temporary environment, so there is no separate installation step.")
        )
      )
    )
  }

  // Failures of a tool are reported inside the result, not as a JSON-RPC error, so that the model can react to them.
  private def asToolResult(textFox: Fox[String]): Future[Either[JsonRpcError, JsValue]] =
    textFox.futureBox.map {
      case Full(text)       => Right(toolResult(text, isError = false))
      case failure: Failure => Right(toolResult(formatFailureChain(failure), isError = true))
      case Empty            => Right(toolResult("No result", isError = true))
    }

  private def toolResult(text: String, isError: Boolean): JsObject =
    Json.obj("content" -> Json.arr(Json.obj("type" -> "text", "text" -> text)), "isError" -> isError)
}
