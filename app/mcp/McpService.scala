package mcp

import com.fasterxml.jackson.databind.ObjectMapper
import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.Fox
import io.modelcontextprotocol.common.McpTransportContext
import io.modelcontextprotocol.json.McpJsonMapper
import io.modelcontextprotocol.json.jackson2.JacksonMcpJsonMapper
import io.modelcontextprotocol.json.schema.jackson2.DefaultJsonSchemaValidator
import io.modelcontextprotocol.server.transport.DefaultServerTransportSecurityValidator
import io.modelcontextprotocol.server.{McpServer, McpStatelessServerFeatures}
import io.modelcontextprotocol.spec.McpSchema
import io.modelcontextprotocol.spec.McpSchema.{CallToolRequest, CallToolResult, Tool, ToolAnnotations}
import models.user.User
import play.api.libs.json.Json
import play.api.mvc.{Headers, Result}
import reactor.core.publisher.Mono
import security.{Scope, ShortLivedTokenService}
import utils.WkConf

import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.*
import scala.jdk.FutureConverters.*

/** The WEBKNOSSOS MCP server, built on the MCP Java SDK. The SDK implements the protocol (initialization and version
  * negotiation, tools/list, tools/call, tool input validation), this class only contributes the tools. The HTTP
  * transport is PlayMcpTransport, the endpoint is McpController.
  */
@Singleton
class McpService @Inject() (
    shortLivedTokenService: ShortLivedTokenService,
    pythonDocsService: PythonDocsService,
    emSkillsService: EmSkillsService,
    conf: WkConf
)(implicit ec: ExecutionContext)
    extends Formatter {

  // Created explicitly rather than looked up via the SDK's ServiceLoader, which is unreliable with Play's classloaders.
  private val objectMapper = new ObjectMapper()
  private val jsonMapper: McpJsonMapper = new JacksonMcpJsonMapper(objectMapper)

  private val transport = new PlayMcpTransport(
    jsonMapper,
    // Browsers send an Origin header, MCP clients usually do not. A foreign origin means a web page is trying to talk
    // to the server in the name of a user who is logged in via cookie (DNS rebinding, CSRF), so it is rejected.
    DefaultServerTransportSecurityValidator.builder().allowedOrigin(conf.Http.uri.stripSuffix("/")).build()
  )

  private val getTokenToolName = "get_short_lived_api_token"
  private val listDocsToolName = "list_python_library_docs"
  private val readDocsToolName = "read_python_library_docs_page"
  private val listSkillsToolName = "list_em_processing_skills"
  private val readSkillToolName = "read_em_processing_skill"

  // Key under which PlayMcpTransport hands the authenticated user to the tool handlers.
  private val userContextKey = "webknossos.user"

  private val emptySchema = """{"type": "object", "properties": {}}"""

  private def stringArgumentSchema(name: String, description: String): String =
    Json.stringify(
      Json.obj(
        "type" -> "object",
        "properties" -> Json.obj(name -> Json.obj("type" -> "string", "description" -> description)),
        "required" -> Json.arr(name)
      )
    )

  // Reading docs and skills changes nothing, but they are fetched from outside of this instance.
  private val readsExternalContent =
    ToolAnnotations.builder().readOnlyHint(true).destructiveHint(false).idempotentHint(true).openWorldHint(true).build()

  private def tool(
      name: String,
      title: String,
      description: String,
      inputSchema: String,
      annotations: ToolAnnotations
  ) =
    Tool.builder(name, jsonMapper, inputSchema).title(title).description(description).annotations(annotations).build()

  private val toolSpecifications: Seq[McpStatelessServerFeatures.AsyncToolSpecification] = Seq(
    toolSpecification(
      tool(
        getTokenToolName,
        "Get a short-lived WEBKNOSSOS API token",
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
           |
           |The result lists the scopes the token is limited to, in the form `resource:mode`. Anything outside them
           |is rejected with 403, so check them before planning destructive work.
           |""".stripMargin,
        emptySchema,
        // Issues a new token on every call, but touches no data.
        ToolAnnotations
          .builder()
          .readOnlyHint(false)
          .destructiveHint(false)
          .idempotentHint(false)
          .openWorldHint(false)
          .build()
      )
    )((user, _) => shortLivedTokenFor(user)),
    toolSpecification(
      tool(
        listDocsToolName,
        "List the WEBKNOSSOS Python library documentation",
        """Returns the index of the `webknossos` Python library documentation (llms.txt), a list of links to the
          |documentation pages of the individual modules. Consult this before writing `webknossos` Python code, and
          |then read the relevant pages with the read_python_library_docs_page tool. Run the resulting code with
          |`uv run --with webknossos <script>.py`.""".stripMargin,
        emptySchema,
        readsExternalContent
      )
    )((_, _) => pythonDocsService.getIndex),
    toolSpecification(
      tool(
        readDocsToolName,
        "Read a page of the WEBKNOSSOS Python library documentation",
        """Returns the markdown content of one documentation page of the `webknossos` Python library. Pass a URL as
          |listed by the list_python_library_docs tool, for example
          |https://docs.webknossos.org/api/webknossos/dataset/dataset.md""".stripMargin,
        stringArgumentSchema("url", "URL of the documentation page, must be on https://docs.webknossos.org/"),
        readsExternalContent
      )
    )((_, arguments) => withStringArgument(arguments, "url")(pythonDocsService.getPage)),
    toolSpecification(
      tool(
        listSkillsToolName,
        "List the volume EM processing skills",
        s"""Returns the catalogue of the EM-Skills collection (${EmSkillsService.repositoryUrl}): agent skills for
           |processing and analysing volume electron microscopy data, covering neuron and mitochondria segmentation,
           |annotation planning, segmentation review and visualisation.
           |
           |Consult this before writing your own image processing or analysis code for EM data. The skills work on
           |local files, so combine them with the `webknossos` Python library, which downloads the data from
           |WEBKNOSSOS and uploads the results back.""".stripMargin,
        emptySchema,
        readsExternalContent
      )
    )((_, _) => emSkillsService.getCatalogue),
    toolSpecification(
      tool(
        readSkillToolName,
        "Read one volume EM processing skill",
        """Returns the SKILL.md of one skill from the EM-Skills collection, which describes when to use it and how
          |to run it. Pass the skill name as listed by the list_em_processing_skills tool, for example
          |segneuron-inference.""".stripMargin,
        stringArgumentSchema("name", "Name of the skill, e.g. segneuron-inference or mitonet-inference"),
        readsExternalContent
      )
    )((_, arguments) => withStringArgument(arguments, "name")(emSkillsService.getSkill))
  )

  // Also used to describe the tools in the MCP bundle manifest, see McpBundleService.
  val tools: Seq[Tool] = toolSpecifications.map(_.tool)

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
      |   the script.
      |
      |For processing and analysing the data itself (segmenting neurons or mitochondria, planning annotations,
      |reviewing a segmentation, rendering videos), look at list_em_processing_skills and
      |read_em_processing_skill first, instead of writing such pipelines from scratch. Those skills operate on
      |local files, so use the `webknossos` library to fetch the data and to upload results back.""".stripMargin

  // Registers itself with the transport via setMcpHandler, which then keeps it alive.
  McpServer
    .async(transport)
    .jsonMapper(jsonMapper)
    .jsonSchemaValidator(new DefaultJsonSchemaValidator(objectMapper))
    .serverInfo("webknossos", webknossos.BuildInfo.version)
    .instructions(instructions)
    .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
    .tools(toolSpecifications.asJava)
    .build()

  /** Handles one POSTed MCP message on behalf of the given (already authenticated) user. */
  def handlePost(body: String, contentType: Option[String], headers: Headers, user: User): Future[Result] =
    transport.handlePost(body, contentType, headers, McpTransportContext.create(Map(userContextKey -> user).asJava))

  private def toolSpecification(tool: Tool)(
      run: (User, Map[String, Any]) => Fox[String]
  ): McpStatelessServerFeatures.AsyncToolSpecification =
    new McpStatelessServerFeatures.AsyncToolSpecification(
      tool,
      (context: McpTransportContext, request: CallToolRequest) =>
        context.get(userContextKey) match {
          case user: User =>
            val arguments = Option(request.arguments()).map(_.asScala.toMap).getOrElse(Map.empty[String, Any])
            Mono.fromFuture(asToolResult(run(user, arguments)).asJava.toCompletableFuture)
          case _ =>
            // Cannot happen for requests that came through McpController, which only lets authenticated users in.
            Mono.just(toolResult("Not authenticated", isError = true))
        }
    )

  // The SDK validates the arguments against the input schema before calling the tool, this only extracts them.
  private def withStringArgument(arguments: Map[String, Any], name: String)(run: String => Fox[String]): Fox[String] =
    arguments.get(name) match {
      case Some(value: String) => run(value)
      case _                   => Fox.failure(s"Missing or invalid argument: $name")
    }

  private def shortLivedTokenFor(user: User): Fox[String] =
    for {
      token <- shortLivedTokenService.create(user._id, conf.Silhouette.TokenAuthenticator.shortLivedExpiry)
    } yield Json.prettyPrint(
      Json.obj(
        "token" -> token.value,
        "expiresAt" -> token.expiresAt.toString,
        "webknossosUrl" -> conf.Http.uri,
        "organizationId" -> user._organization,
        "scopes" -> Scope.Set.parse(user.mcpAgentScopes).toString,
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

  // Failures of a tool are reported inside the result, not as a JSON-RPC error, so that the model can react to them.
  private def asToolResult(textFox: Fox[String]): Future[CallToolResult] =
    textFox.futureBox.map {
      case Full(text)       => toolResult(text, isError = false)
      case failure: Failure => toolResult(formatFailureChain(failure), isError = true)
      case Empty            => toolResult("No result", isError = true)
    }

  private def toolResult(text: String, isError: Boolean): CallToolResult =
    CallToolResult.builder().addTextContent(text).isError(isError).build()
}
