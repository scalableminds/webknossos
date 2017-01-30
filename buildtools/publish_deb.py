#!/usr/bin/python2

import os
import sys
import subprocess
import shutil
import gzip

archive_dir = "%s/packages" % (os.environ["WORKSPACE"])

if not os.path.isdir(archive_dir):
  print "no artifacts archived. Either this is a failed build or a job that does not archive artifacts"
  sys.exit(0)

deb_packages = filter(lambda f: f.endswith(".deb"), os.listdir(archive_dir))
prod_deb_packages = [deb for deb in deb_packages if not deb.endswith("-dev.deb")]
dev_deb_packages = [deb for deb in deb_packages if not  deb.endswith("-prod.deb")]

def publish_deb_packages(mode, packages):
  prefix_path = "dists/stable/%s/binary-amd64" % os.environ["JOB_NAME"]

  def create_package_info(mode, packages):
    os.chdir(archive_dir)
    if os.path.isdir(mode):
      shutil.rmtree(mode)
    os.mkdir(mode)
    os.chdir(mode)
    for pkg in packages:
      os.symlink("../%s" % pkg, pkg)

    package_info = subprocess.check_output(["dpkg-scanpackages","-m", "./", "/dev/null", prefix_path])
    package_info = package_info.replace(prefix_path+"./", prefix_path)
    os.chdir("..")
    shutil.rmtree(mode)
    return package_info

  def extend_repo(mode, packages_info, packages):
    repo_dir = "/srv/scmrepo/%s/%s" % (mode, prefix_path)
    os.chdir(repo_dir)

    symlinks_new = True
    for pkg in packages:
      target = "%s/%s" % (archive_dir, pkg)
      if os.path.exists(pkg) or os.path.lexists(pkg):
        symlinks_new = False
      else:
        shutil.copyfile(target, pkg)

    if symlinks_new:
      packages_file = gzip.open("Packages.gz", "a")
      packages_file.write(packages_info)
      packages_file.close()

  packages_info = create_package_info(mode, packages)

  extend_repo(mode, packages_info, packages)

publish_deb_packages("dev", dev_deb_packages)
publish_deb_packages("prod", prod_deb_packages)
