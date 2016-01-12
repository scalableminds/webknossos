FROM 1science/sbt:0.13.8-oracle-jre-8

# Install node
RUN apk add --update nodejs curl make gcc g++ binutils python linux-headers paxctl libgcc libstdc++ && \
  npm install -g gulp

RUN mkdir -p /srv/webknossos
WORKDIR /srv/webknossos

ADD package.json package.json
RUN npm install && \
  apk del curl make gcc g++ binutils python linux-headers paxctl

ADD project project
ADD version version
RUN sbt exit

RUN mkdir -p ~/.sbt/0.13 && \
  echo "scalacOptions ++= Seq(\"-Xmax-classfile-name\",\"72\")" > ~/.sbt/0.13/local.sbt

ADD . .
# RUN gulp
RUN sbt compile

CMD [ "sbt", "run" ]
