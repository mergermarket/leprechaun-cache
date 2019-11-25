#!/bin/sh

set -e

if [[ -z "${CI}" ]]; then
  export CI='X'
fi

npm ci
npm run acuris-eslint
npm test
npm run test:integration
npm run build
npm config set '//registry.npmjs.org/:_authToken' "${NPM_TOKEN}"
npm publish --access public