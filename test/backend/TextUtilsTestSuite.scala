package backend

import com.scalableminds.util.tools.TextUtils
import com.scalableminds.util.tools.{Failure, Full}
import org.scalatestplus.play.PlaySpec

class TextUtilsTestSuite extends PlaySpec {

  "renderTemplateReplacements" should {
    "replace all provided placeholders (even multiple occurrences)" in {
      val template = "Hello, {{name}}! Welcome to {{site}}. Goodbye, {{name}}."
      val result = TextUtils.renderTemplateReplacements(
        template,
        "{{name}}" -> "Alice",
        "{{site}}" -> "WEBKNOSSOS"
      )

      assert(result == Full("Hello, Alice! Welcome to WEBKNOSSOS. Goodbye, Alice."))
    }

    "support dollar signs in replacement values" in {
      val template = """<meta property="og:title" content="" />"""
      val result = TextUtils.renderTemplateReplacements(
        template,
        """<meta property="og:title" content="" />""" -> """<meta property="og:title" content="dataset-$foo" />"""
      )

      assert(result == Full("""<meta property="og:title" content="dataset-$foo" />"""))
    }

    "fail when a placeholder is missing" in {
      val result = TextUtils.renderTemplateReplacements("Hello world", "{{missing}}" -> "value")

      assert(result.isInstanceOf[Failure])
    }
  }
}
