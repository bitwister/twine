#!/bin/bash -x

# This script provides a way to develop within docker container,
# elimnating the need to setup project-specific development environment 

# This script assumes that source code was mounted as docker volume,
# to do that you need to specify:
# volumes:
#   - ./backend:/app/
#  in the docker-compose.yml file

echo "Synchronizing node_modules with docker host..."

# Sync node_modules container>host to provide type checking and hints in editor
rsync -av --info=progress2 --info=name0 /app_dependencies/node_modules/ /app_live/node_modules &

# Sync volume /app_live host>container to container's path /app 
# This is done to avoid slow reads on MacOS/Windows docker volumes
npx nodemon -L -w /app_live -e ts --exec rsync -av --exclude node_modules /app_live/ /app &

echo "Launching development environment..."

npm run develop