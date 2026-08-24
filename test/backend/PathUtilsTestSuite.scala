package backend

import com.scalableminds.util.io.PathUtils
import org.scalatest.wordspec.AsyncWordSpec

import java.nio.file.Path

class PathUtilsTestSuite extends AsyncWordSpec {

  "PathUtils.findCommonRootDirectory" should {

    "truncate the common prefix right before the last boundary directory" in {
      val paths = List(
        Path.of("upload/dataset/color/1/z0/y0/x0.wkw"),
        Path.of("upload/dataset/color/1/z0/y0/x1.wkw")
      )
      val root = PathUtils.findCommonRootDirectory(paths, List("color", "segmentation"))
      assert(root == Path.of("upload/dataset"))
    }

    "strip a lone remaining file name when only a single path is given" in {
      val paths = List(Path.of("upload/dataset/onlyfile.txt"))
      val root = PathUtils.findCommonRootDirectory(paths, List("color", "segmentation"))
      assert(root == Path.of("upload/dataset"))
    }

    "fall back to the plain longest common prefix when no boundary name matches" in {
      val paths = List(Path.of("upload/a/b/x.txt"), Path.of("upload/a/b/y.txt"))
      val root = PathUtils.findCommonRootDirectory(paths, List("color", "segmentation"))
      assert(root == Path.of("upload/a/b"))
    }

    "truncate at the last, not the first, boundary match" in {
      val paths = List(
        Path.of("upload/color/1/color_meta/x.wkw"),
        Path.of("upload/color/1/color_meta/y.wkw")
      )
      val root = PathUtils.findCommonRootDirectory(paths, List("color"))
      assert(root == Path.of("upload/color/1"))
    }

  }
}
