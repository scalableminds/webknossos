package braingames.io

import java.nio.file._

trait DirectoryChangeHandler {
  def onCreate(path: Path)
  def onDelete(path: Path)
  def onStart(path: Path, recursive: Boolean)
  def onTick(path: Path, recursive: Boolean)
}