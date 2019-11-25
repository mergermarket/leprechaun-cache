#!/bin/sh

set -e

git fetch
git checkout master
git pull
npm run acuris-eslint
npm test
npm run test:integration
npm version patch -m "Version %s"
git push --follow-tags