import appJson from './app.json';

const config = appJson.expo;

export default {
  expo: {
    ...config,
    extra: {
      ...config.extra,
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  },
};
