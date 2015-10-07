FROM java:7

# Install sbt
RUN apt-get update \
&& apt-get install -y apt-transport-https \
&& echo "deb https://dl.bintray.com/sbt/debian /" >> /etc/apt/sources.list.d/sbt.list \
&& apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 642AC823 \
&& apt-get update \
&& apt-get install -y sbt

# Install node
RUN curl -sL https://deb.nodesource.com/setup_4.x | bash - \
&& apt-get install -y nodejs \
&& npm install -g bower gulp

RUN mkdir /srv/webknossos
WORKDIR /srv/webknossos

ADD package.json package.json
RUN npm install

ADD project project
ADD version version
RUN sbt exit

ADD . .
# RUN gulp
RUN sbt compile

CMD [ "sbt", "run" ]
