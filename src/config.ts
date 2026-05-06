export default () => ({
  port: Number(process.env.PORT ?? 3003),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  serviceName: process.env.SERVICE_NAME ?? 'beefriends-match-chat-service',
  userServiceUrl: process.env.USER_SERVICE_URL ?? 'http://localhost:3001',
});
