import appJson from './app.json';

const config = appJson.expo;

export default {
  expo: {
    ...config,
    ...(process.env.EXPO_SLUG ? { slug: process.env.EXPO_SLUG } : {}),
    extra: {
      ...config.extra,
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  },
};
