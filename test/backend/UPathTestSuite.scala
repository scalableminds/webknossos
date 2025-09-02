package backend

import com.scalableminds.webknossos.datastore.helpers.UPath
import org.scalatestplus.play.PlaySpec

class UPathTestSuite extends PlaySpec {

  "UPath" should {
    "Be constructable from well-formed string" in {
      assert(UPath.fromString("relative/elsewhere").exists(_.toString == "./relative/elsewhere"))
      assert(UPath.fromString("./relative/elsewehere").exists(_.toString == "./relative/elsewehere"))
      assert(UPath.fromString("/absolute/somewhere").exists(_.toString == "/absolute/somewhere"))
      assert(UPath.fromString("/absolute/some$where").exists(_.toString == "/absolute/some$where"))
      assert(UPath.fromString("/absolute/with²Unicode").exists(_.toString == "/absolute/with²Unicode"))
      assert(UPath.fromString("/absolute/ with space").exists(_.toString == "/absolute/ with space"))
      assert(UPath.fromString("file:///absolute/with²Unicode").exists(_.toString == "/absolute/with²Unicode"))
      assert(UPath.fromString("s3://bucket/key").exists(_.toString == "s3://bucket/key"))
      assert(UPath.fromString("s3:/somewhere").exists(_.toString == "./s3:/somewhere"))
      assert(UPath.fromString("s3:somewhere").exists(_.toString == "./s3:somewhere"))
    }

    "Not be constructable from malformed string" in {
      assert(UPath.fromString("file://somewhere").isEmpty)
    }

    "resolve strings correctly (local)" in {
      assert(
        (UPath.fromStringUnsafe("relative/elsewhere") / "subdirectory").toString == "./relative/elsewhere/subdirectory")
      assert(
        (UPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory").toString == "./relative/elsewhere/subdirectory")
      assert(
        (UPath
          .fromStringUnsafe("relative/elsewhere/") / "subdirectory/").toString == "./relative/elsewhere/subdirectory")
      assert((UPath.fromStringUnsafe("relative/elsewhere/") / "..").toString == "./relative")
      assert((UPath.fromStringUnsafe("relative/elsewhere/") / ".." / "..").toString == "./")
    }

    "resolve strings correctly (remote)" in {
      assert(
        (UPath.fromStringUnsafe("https://hello.com/there") / "subkey").toString == "https://hello.com/there/subkey"
      )
      assert(
        (UPath.fromStringUnsafe("https://hello.com/there/") / "subkey").toString == "https://hello.com/there/subkey"
      )
      assert(
        (UPath.fromStringUnsafe("https://hello.com/there") / "subkey/").toString == "https://hello.com/there/subkey/"
      )
      assert(
        (UPath.fromStringUnsafe("https://hello.com/there") / "subkey/" / "subsub").toString == "https://hello.com/there/subkey/subsub"
      )
      assert(
        (UPath.fromStringUnsafe("https://hello.com/there") / "..").toString == "https://hello.com"
      )
      assert(
        (UPath.fromStringUnsafe("https://hello.com") / "..").toString == "https://hello.com"
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
          .toString == "/somewhere/relative/elsewhere")
      assert(
        UPath
          .fromStringUnsafe("/absolute/elsewhere")
          .resolvedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "/absolute/elsewhere")
      assert(
        UPath
          .fromStringUnsafe("s3://remote/elsewhere")
          .resolvedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "s3://remote/elsewhere")
    }

    "be correctly relativizedIn" in {
      assert(
        UPath
          .fromStringUnsafe("relative/elsewhere")
          .relativizedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "./relative/elsewhere")
      assert(
        UPath
          .fromStringUnsafe("/absolute/elsewhere")
          .relativizedIn(UPath.fromStringUnsafe("/absolute"))
          .toString == "./elsewhere")
      assert(
        UPath
          .fromStringUnsafe("s3://remote/elsewhere")
          .relativizedIn(UPath.fromStringUnsafe("/somewhere"))
          .toString == "s3://remote/elsewhere")
    }
  }

}
