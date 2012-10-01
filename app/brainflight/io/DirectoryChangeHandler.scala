package brainflight.io

import name.pachler.nio.file.Path
import java.io.File

trait DirectoryChangeHandler {
  def onCreate(path: Path)
  def onDelete(path: Path)
  def onStart(path: Path)
}