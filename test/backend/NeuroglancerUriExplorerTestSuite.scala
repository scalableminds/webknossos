package backend

import com.scalableminds.util.box.Full
import com.scalableminds.webknossos.datastore.explore.{ExploreLayerUtils, NeuroglancerUriExplorer}
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.{JsObject, Json}

class NeuroglancerUriExplorerTestSuite extends AnyWordSpec with ExploreLayerUtils {

  private val stateJson =
    """{"layers":[{"type":"segmentation","source":"precomputed://gs://bucket/seg","annotationColor":"#8f8f8a","segmentQuery":"#interneuron #L2","name":"seg"}]}"""
  private val stateJsonObj = Json.parse(stateJson).as[JsObject]

  private def encodeUriComponentLike(s: String): String = {
    // Mimics JS encodeURIComponent: percent-encodes everything except unreserved characters.
    val safeChars = "-_.!~*'()"
    s.flatMap { ch =>
      if (ch.isLetterOrDigit || safeChars.contains(ch)) ch.toString
      else "%%%02X".format(ch.toByte)
    }
  }

  "NeuroglancerUriExplorer.extractRawFragment" should {
    "extract the fragment even if it contains raw, unescaped '#' characters" in {
      val uri = s"https://ngl.microns-explorer.org/#!$stateJson"
      val result = NeuroglancerUriExplorer.extractRawFragment(uri)
      assert(result == Full(stateJson))
    }

    "fail if the uri has no matching '#!' fragment marker" in {
      val result = NeuroglancerUriExplorer.extractRawFragment("https://ngl.microns-explorer.org/no-fragment-here")
      assert(result.isEmpty)
    }
  }

  "NeuroglancerUriExplorer.parseFragmentAsJson" should {
    "parse a singly percent-encoded fragment" in {
      val encodedOnce = encodeUriComponentLike(stateJson)
      val result = NeuroglancerUriExplorer.parseFragmentAsJson(encodedOnce)
      assert(result == Full(stateJsonObj))
    }

    "parse a doubly percent-encoded fragment (e.g. '%2522' instead of '%22')" in {
      // Regression test for a real-world report: some relaying tool re-applied percent-encoding on top
      // of an already-encoded neuroglancer link, turning e.g. "%22" into "%2522".
      val encodedTwice = encodeUriComponentLike(encodeUriComponentLike(stateJson))
      val result = NeuroglancerUriExplorer.parseFragmentAsJson(encodedTwice)
      assert(result == Full(stateJsonObj))
    }

    "fail for a fragment that is not valid JSON even after decoding twice" in {
      val result = NeuroglancerUriExplorer.parseFragmentAsJson("not-json-at-all")
      assert(result.isEmpty)
    }

    "parse a raw, entirely unencoded fragment (as a freshly copied Neuroglancer link looks)" in {
      val result = NeuroglancerUriExplorer.parseFragmentAsJson(stateJson)
      assert(result == Full(stateJsonObj))
    }

    "preserve a literal '+' character instead of turning it into a space" in {
      // Regression test: URLDecoder.decode applies form semantics by default, where "+" means space.
      // Neuroglancer never encodes a space as "+" (it uses "%20"), and signed cloud-storage URLs
      // frequently contain a literal "+", so decoding must not silently mangle it.
      val jsonWithPlus = """{"layers":[{"source":"precomputed://gs://bucket/a+b","name":"seg"}]}"""
      val encodedOnce = encodeUriComponentLike(jsonWithPlus)
      val result = NeuroglancerUriExplorer.parseFragmentAsJson(encodedOnce)
      assert(result == Full(Json.parse(jsonWithPlus).as[JsObject]))
    }

    "fail gracefully (instead of throwing) for a malformed percent escape" in {
      // A lone "%" not followed by two hex digits makes URLDecoder.decode throw IllegalArgumentException.
      val result = NeuroglancerUriExplorer.parseFragmentAsJson("%7B%22a%22:%22b%zz%22%7D")
      assert(result.isEmpty)
    }
  }

  "ExploreLayerUtils.escapeExtraFragmentHashes" should {
    "leave uris without a fragment untouched" in
      assert(escapeExtraFragmentHashes("https://example.com/path") == "https://example.com/path")

    "leave a single, legitimate fragment delimiter untouched" in
      assert(
        escapeExtraFragmentHashes("https://example.com/#!foo") == "https://example.com/#!foo"
      )

    "escape further raw '#' characters after the first one" in
      assert(
        escapeExtraFragmentHashes(
          """https://h01-dot-neuroglancer-demo.appspot.com/#!{"segmentQuery":"#interneuron #L2"}"""
        ) == """https://h01-dot-neuroglancer-demo.appspot.com/#!{"segmentQuery":"%23interneuron %23L2"}"""
      )

    "let java.net.URI parse a sanitized uri that would otherwise throw" in {
      import java.net.URI
      val rawUri =
        "https://h01-dot-neuroglancer-demo.appspot.com/#!%7B%22segmentQuery%22:%22#interneuron%20#L2%22%7D"
      assertThrows[java.net.URISyntaxException](new URI(rawUri))
      val sanitized = escapeExtraFragmentHashes(rawUri)
      val parsed = new URI(sanitized)
      assert(parsed.getScheme == "https")
      assert(parsed.getHost == "h01-dot-neuroglancer-demo.appspot.com")
    }
  }

  "NeuroglancerUriExplorer.extractPrimarySourceUrl" should {
    "accept a plain string source" in {
      val source = Json.parse(""""precomputed://gs://bucket/seg"""")
      assert(NeuroglancerUriExplorer.extractPrimarySourceUrl(source) == Full("precomputed://gs://bucket/seg"))
    }

    "accept an object source with a 'url' field" in {
      val source = Json.parse("""{"url":"precomputed://gs://bucket/seg","subsources":{"default":true}}""")
      assert(NeuroglancerUriExplorer.extractPrimarySourceUrl(source) == Full("precomputed://gs://bucket/seg"))
    }

    "accept an array of sources and use the first entry" in {
      val source = Json.parse(
        """[{"url":"precomputed://gs://h01-release/data/20210601/c3","enableDefaultSubsources":false},"precomputed://gs://other-bucket/segment_properties"]"""
      )
      assert(
        NeuroglancerUriExplorer.extractPrimarySourceUrl(source) ==
          Full("precomputed://gs://h01-release/data/20210601/c3")
      )
    }

    "fail for an empty array" in
      assert(NeuroglancerUriExplorer.extractPrimarySourceUrl(Json.arr()).isEmpty)

    "fail for a source shape without a usable url" in
      assert(NeuroglancerUriExplorer.extractPrimarySourceUrl(Json.obj("foo" -> "bar")).isEmpty)
  }

}
