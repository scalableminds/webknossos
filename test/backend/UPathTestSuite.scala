package backend

import com.scalableminds.webknossos.datastore.helpers.UPath
import org.scalatest.wordspec.AsyncWordSpec

class UPathTestSuite extends AsyncWordSpec {

  "UPath" should {

    "Be constructable from well-formed string" in {
      assert(UPath.fromString("relative/elsewhere").exists(_.toString == "./relative/elsewhere"))
      assert(UPath.fromString("./relative/elsewhere").exists(_.toString == "./relative/elsewhere"))
      assert(UPath.fromString("/absolute/somewhere").exists(_.toString == "/absolute/somewhere"))
      assert(UPath.fromString("/absolute/some$where").exists(_.toString == "/absolute/some$where"))
      assert(UPath.fromString("/absolute/with²Unicode").exists(_.toString == "/absolute/with²Unicode"))
      assert(UPath.fromString("/absolute/ with space").exists(_.toString == "/absolute/ with space"))
      assert(UPath.fromString("file:///absolute/with²Unicode").exists(_.toString == "/absolute/with²Unicode"))
      assert(UPath.fromString("s3://bucket/key").exists(_.toString == "s3://bucket/key"))
      assert(UPath.fromString("s3:/somewhere").exists(_.toString == "./s3:/somewhere"))
      assert(UPath.fromString("s3:somewhere").exists(_.toString == "./s3:somewhere"))
    }

    "Not be constructable from malformed string" in
      assert(UPath.fromString("file://somewhere").isEmpty)

    "resolve strings correctly (local)" in {
      assert(
        (UPath.fromStringUnsafe("relative/elsewhere") / "subdirectory").toString == "./relative/elsewhere/subdirectory"
      )
      assert(
        (UPath.fromStringUnsafe("relative/elsewhere/") / "subdirectory").toString == "./relative/elsewhere/subdirectory"
      )
      assert(
        (UPath.fromStringUnsafe(
          "relative/elsewhere/"
        ) / "subdirectory/").toString == "./relative/elsewhere/subdirectory"
      )
      assert((UPath.fromStringUnsafe("relative/elsewhere/") / "..").toString == "./relative")
      assert((UPath.fromStringUnsafe("relative/elsewhere/") / ".." / "..").toString == "./")
    }

    "resolve strings correctly (remote)" in {
      assert(
        (UPath.fromStringUnsafe("https://example.com/key") / "subkey").toString == "https://example.com/key/subkey"
      )
      assert(
        (UPath.fromStringUnsafe("https://example.com/key/") / "subkey").toString == "https://example.com/key/subkey"
      )
      assert(
        (UPath.fromStringUnsafe("https://example.com/key") / "subkey/").toString == "https://example.com/key/subkey/"
      )
      assert(
        (UPath.fromStringUnsafe(
          "https://example.com/key"
        ) / "subkey/" / "subsub").toString == "https://example.com/key/subkey/subsub"
      )
      assert(
        (UPath.fromStringUnsafe("https://example.com/key") / "..").toString == "https://example.com"
      )
      assert(
        (UPath.fromStringUnsafe("https://example.com") / "..").toString == "https://example.com"
      )
    }

    "yield sensible basename" in {
      assert(
        UPath.fromStringUnsafe("/local/with/trailing/slash/").basename == "slash"
      )
      assert(
        UPath.fromStringUnsafe("/local/without/trailing/slash").basename == "slash"
      )
      assert(
        UPath.fromStringUnsafe("https://remote/without/trailing/slash").basename == "slash"
      )
      assert(
        UPath.fromStringUnsafe("https://remote/without/trailing/slash").basename == "slash"
      )
    }

    "have correct boolean properties" in {
      val localRelative = UPath.fromStringUnsafe("relative/elsewhere")
      assert(localRelative.isLocal)
      assert(!localRelative.isRemote)
      assert(localRelative.isRelative)
      assert(!localRelative.isAbsolute)
      val localAbsolute = UPath.fromStringUnsafe("/absolute/somewhere")
      assert(localAbsolute.isLocal)
      assert(!localAbsolute.isRemote)
      assert(!localAbsolute.isRelative)
      assert(localAbsolute.isAbsolute)
      val remote = UPath.fromStringUnsafe("s3://bucket/key")
      assert(!remote.isLocal)
      assert(remote.isRemote)
      assert(!remote.isRelative)
      assert(remote.isAbsolute)
    }

    "be correctly resolvedIn" in {
      assert(
        UPath
          .fromStringUnsafe("relative/elsewhere")
          .resolvedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "/somewhere/relative/elsewhere"
      )
      assert(
        UPath
          .fromStringUnsafe("/absolute/elsewhere")
          .resolvedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "/absolute/elsewhere"
      )
      assert(
        UPath
          .fromStringUnsafe("s3://remote/elsewhere")
          .resolvedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "s3://remote/elsewhere"
      )
    }

    "be correctly relativizedIn" in {
      assert(
        UPath
          .fromStringUnsafe("relative/elsewhere")
          .relativizedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "./relative/elsewhere"
      )
      assert(
        UPath
          .fromStringUnsafe("/absolute/elsewhere")
          .relativizedIn(UPath.fromStringUnsafe("/absolute"))
          .toString == "./elsewhere"
      )
      assert(
        UPath
          .fromStringUnsafe("s3://remote/elsewhere")
          .relativizedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "s3://remote/elsewhere"
      )
    }

    "correctly answer startsWith" in {
      checkStartsWith("relative/somewhere", "relative")
      checkStartsNotWith("relative/somewhere", "elsewhere")
      // startsWith compares actual parents, not string prefix!
      checkStartsNotWith("relativeElsewhere", "relative")
      checkStartsWith("/absolute/somewhere", "/absolute")
      checkStartsWith("/absolute/somewhere", "/absolute/")
      // trailing slash is allowed both ways
      checkStartsWith("/absolute/trailingSlash", "/absolute/trailingSlash/")
      checkStartsWith("/absolute/trailingSlash/", "/absolute/trailingSlash")
      checkStartsNotWith("/absolute/somewhere", "/elsewhere")
      checkStartsNotWith("/absolute/somewhere", "https://example.com")
      // trailing slash is allowed both ways
      checkStartsWith("https://example.com/path/somewhere", "https://example.com/path/")
      checkStartsWith("https://example.com/path/somewhere", "https://example.com/path")
      checkStartsWith("https://example.com/path/", "https://example.com/path/")
      checkStartsWith("https://example.com/path", "https://example.com/path/")
      checkStartsWith("https://example.com/path", "https://example.com/path")
      checkStartsWith("https://example.com/path/", "https://example.com/path")
      // startsWith compares actual parents, not string prefix!
      checkStartsNotWith("https://example.com/pathSomewhereElse", "https://example.com/path")
    }

    "parse ZipEntryUPath correctly" in {
      val upath = UPath.fromStringUnsafe("s3://bucket/archive.zip|zip:inner/file.bin")
      assert(upath.toString == "s3://bucket/archive.zip|zip:inner/file.bin")
      assert(upath.isRemote)
      assert(!upath.isLocal)
      assert(upath.isAbsolute)
      assert(upath.basename == "file.bin")
      assert(upath.parent.toString == "s3://bucket/archive.zip|zip:inner")
      assert(upath.parent.parent.toString == "s3://bucket/archive.zip")
      assert((upath / "extra").toString == "s3://bucket/archive.zip|zip:inner/file.bin/extra")
    }

    "parse ZipEntryUPath root reference (no colon)" in {
      val upath = UPath.fromStringUnsafe("s3://bucket/archive.zip|zip")
      assert(upath.toString == "s3://bucket/archive.zip|zip")
      assert(upath.isRemote)
      assert(upath.isAbsolute)
    }

    "strip single leading slash from zip inner path" in {
      val upath = UPath.fromStringUnsafe("s3://bucket/archive.zip|zip:/inner/file.bin")
      assert(upath.toString == "s3://bucket/archive.zip|zip:inner/file.bin")
    }

    "reject double leading slash in zip inner path" in {
      assert(UPath.fromString("s3://bucket/archive.zip|zip://inner/file.bin").isEmpty)
    }

    "round-trip ZipEntryUPath through JSON" in {
      import play.api.libs.json.Json
      val upath = UPath.fromStringUnsafe("s3://bucket/archive.zip|zip:inner/file.bin")
      val json = Json.toJson(upath)
      val parsed = json.as[UPath]
      assert(parsed.toString == upath.toString)
    }

    "construct ZipEntryUPath from local outer path" in {
      val upath = UPath.fromStringUnsafe("/local/data.zip|zip:subdir/entry.txt")
      assert(upath.toString == "/local/data.zip|zip:subdir/entry.txt")
      assert(upath.isLocal)
      assert(upath.basename == "entry.txt")
    }
  }

  private def checkStartsWith(pathLiteral1: String, pathLiteral2: String) =
    assert(UPath.fromStringUnsafe(pathLiteral1).startsWith(UPath.fromStringUnsafe(pathLiteral2)))

  private def checkStartsNotWith(pathLiteral1: String, pathLiteral2: String) =
    assert(!UPath.fromStringUnsafe(pathLiteral1).startsWith(UPath.fromStringUnsafe(pathLiteral2)))

}
