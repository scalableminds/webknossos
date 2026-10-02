package backend

import mcp.{JsonRpc, JsonRpcError, PythonDocsService}
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.{JsNumber, Json}

class McpTestSuite extends AnyWordSpec {

  "JsonRpc.parseRequest" should {
    "parse a request with params" in {
      val parsed = JsonRpc.parseRequest(
        Json.obj("jsonrpc" -> "2.0", "id" -> 1, "method" -> "tools/call", "params" -> Json.obj("name" -> "ping"))
      )
      assert(parsed.exists(_.method == "tools/call"))
      assert(parsed.exists(_.id.contains(JsNumber(1))))
      assert(parsed.exists(request => (request.params \ "name").asOpt[String].contains("ping")))
      assert(parsed.exists(!_.isNotification))
    }

    "treat a request without id as a notification" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "method" -> "notifications/initialized"))
      assert(parsed.exists(_.isNotification))
    }

    "treat a null id as a notification" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> None, "method" -> "ping"))
      assert(parsed.exists(_.isNotification))
    }

    "default missing params to an empty object" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> 1, "method" -> "tools/list"))
      assert(parsed.exists(_.params == Json.obj()))
    }

    "reject a request without a method" in {
      val parsed = JsonRpc.parseRequest(Json.obj("jsonrpc" -> "2.0", "id" -> 1))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidRequestCode))
    }

    "reject a batched request" in {
      val parsed = JsonRpc.parseRequest(Json.arr(Json.obj("jsonrpc" -> "2.0", "method" -> "ping")))
      assert(parsed.swap.exists(_.code == JsonRpcError.invalidRequestCode))
    }

    "reject a non-object request" in
      assert(JsonRpc.parseRequest(Json.toJson("ping")).isLeft)
  }

  "JsonRpc.error" should {
    "use a null id if there is none" in {
      val error = JsonRpc.error(None, JsonRpcError.methodNotFound("foo"))
      assert((error \ "id").asOpt[String].isEmpty)
      assert((error \ "error" \ "code").as[Int] == JsonRpcError.methodNotFoundCode)
      assert((error \ "error" \ "message").as[String] == "Method not found: foo")
    }
  }

  "PythonDocsService.isAllowedUrl" should {
    "allow documentation pages" in {
      assert(PythonDocsService.isAllowedUrl("https://docs.webknossos.org/llms.txt"))
      assert(PythonDocsService.isAllowedUrl("https://docs.webknossos.org/api/webknossos/dataset/dataset.md"))
    }

    "reject other hosts" in {
      assert(!PythonDocsService.isAllowedUrl("https://evil.example.com/x.md"))
      assert(!PythonDocsService.isAllowedUrl("https://docs.webknossos.org.evil.com/x.md"))
      assert(!PythonDocsService.isAllowedUrl("https://evil.com/?x=https://docs.webknossos.org/llms.txt"))
    }

    "reject other schemes" in {
      assert(!PythonDocsService.isAllowedUrl("http://docs.webknossos.org/llms.txt"))
      assert(!PythonDocsService.isAllowedUrl("file:///etc/passwd"))
      assert(!PythonDocsService.isAllowedUrl("not a url"))
    }
  }
}
