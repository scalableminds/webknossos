@Library('jenkins-library@master') _

wrap(repo: "scalableminds/webknossos") {

  stage("Prepare") {

    sh "sudo /var/lib/jenkins/fix_workspace.sh webknossos"

    checkout scm
    sh "rm -rf packages"

    def commit = gitCommit()

    env.DOCKER_CACHE_PREFIX = "~/.webknossos-cache"
    env.COMPOSE_PROJECT_NAME = "webknossos_${env.BRANCH_NAME}_${commit}"
    env.USER_NAME = env.USER
    env.USER_UID = sh(returnStdout: true, script: 'id -u').trim()
    env.USER_GID = sh(returnStdout: true, script: 'id -g').trim()
    sh "mkdir -p ${env.DOCKER_CACHE_PREFIX}"
    sh "docker-compose pull base"
    sh "docker-compose pull mongo"
  }


  stage("Build") {

    sh "docker-compose run frontend-dependencies"
    sh "docker-compose run frontend-docs"
    sh "docker-compose run base sbt clean compile stage"
    sh "docker build --pull -t scalableminds/webknossos:${env.BRANCH_NAME}__${env.BUILD_NUMBER} ."
  }


  stage("Test") {

    sh "docker-compose run frontend-linting"
    sh "docker-compose run frontend-flow"
    sh "docker-compose run frontend-tests"
    retry (3) {
      sh "docker-compose run e2e-tests"
    }
    sh """
      DOCKER_TAG=${env.BRANCH_NAME}__${env.BUILD_NUMBER} docker-compose up webknossos &
      sleep 10
      ./test/infrastructure/deployment.bash
      docker-compose down --volumes --remove-orphans
    """
  }


  dockerPublish(repo: "scalableminds/webknossos")


  stage("Build system packages") {

    env.VERSION = readFile('version').trim()
    sh "./buildtools/make_dist.sh oxalis ${env.BRANCH_NAME} ${env.BUILD_NUMBER}"

    def base_port = 11000
    def port = base_port + sh(returnStdout: true, script: """
      grep -nx "${BRANCH_NAME}" /var/lib/jenkins/jobs/webknossos/branches.txt > /dev/null || \
        echo "${BRANCH_NAME}" >> /var/lib/jenkins/jobs/webknossos/branches.txt
      grep -nx "${BRANCH_NAME}" /var/lib/jenkins/jobs/webknossos/branches.txt | grep -Eo '^[^:]+' | head -n1
      """).trim().toInteger()

    def modes = ["dev", "prod"]
    def pkg_types = ["deb", "rpm"]
    for (int i = 0; i < modes.size(); i++) {
      for (int j = 0; j < pkg_types.size(); j++) {
        sh "./buildtools/build-helper.sh oxalis ${env.BRANCH_NAME} ${env.BUILD_NUMBER} ${port} ${modes[i]} ${pkg_types[j]}"
      }
    }

    sh "mkdir packages && mv *.deb packages && mv *.rpm packages"
  }


  stage("Publish system packages") {

    sh "echo ${env.BRANCH_NAME} > .git/REAL_BRANCH"
    withEnv(["JOB_NAME=oxalis"]) {
      sh "./buildtools/publish_deb.py"
    }
  }
}
