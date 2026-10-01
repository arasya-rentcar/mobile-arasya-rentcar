// Wraps app.json so the release setup is a few one-line edits (see README, "Rilis pertama"):
//  - owner and extra.eas.projectId: fill in the empty values in app.json. Empty means "not set yet".
//  - google-services.json: just put the file in the repo root. It is picked up automatically,
//    no edit needed (android.googleServicesFile is set only when the file exists).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const projectId = config.extra?.eas?.projectId || undefined;
  const hasGoogleServices = fs.existsSync(path.join(__dirname, 'google-services.json'));
  const { eas, ...extra } = config.extra ?? {};
  return {
    ...config,
    owner: config.owner || undefined,
    extra: { ...extra, ...(projectId ? { eas: { ...eas, projectId } } : {}) },
    android: {
      ...config.android,
      ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    },
  };
};
