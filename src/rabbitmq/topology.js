// insert configuration file
const config = require('../../configuration.js')(process.env.NODE_ENV);

module.exports = function (rabbit, MongoCrawlerDocs) {
  const settings = {};
  settings.exchanges = [];
  settings.queues = [];
  settings.bindings = [];

  // arguments used to establish a connection to a broker
  settings.connection =
    {
      name: config.rabbit.connection.name,
      user: config.rabbit.connection.username,
      pass: config.rabbit.connection.password,
      server: config.rabbit.connection.server,
      port: config.rabbit.connection.port,
      vhost: config.rabbit.connection.VHost,
      timeout: config.rabbit.connection.timeout,
      failAfter: config.rabbit.connection.failAfter,
      retryLimit: config.rabbit.connection.retryLimit
    };

  // exchange, queue, binding for message Lists to requeue to another queues
  settings.exchanges.push(
    {
      name: "trackinops.crawler-message-router",
      type: "direct",
      autoDelete: false,
      persistent: true,
      durable: true
    });
  settings.queues.push({
    name: 'crawler_queUrlList_requeue', // queue name 
    autoDelete: false,
    subscribe: true,
    persistent: true,
    durable: true,
    noCacheKeys: true,
    limit: config.rabbit.requePrefetchLimit // queue prefetch / parallel messages taken from queue
  });
  settings.bindings.push({
    exchange: "trackinops.crawler-message-router",
    target: "crawler_queUrlList_requeue",
    keys: ["crawler_requeue"]
  });


  if (config.NODE_ENV === 'development') {
    // add console logs
    settings.logging = {
      adapters: {
        stdOut: { // adds a console logger at the "info" level
          level: config.NODE_LOG_LEVEL, // 3 for info
          bailIfDebug: true
        }
      }
    }
  }

  return rabbit.configure(settings).then(null, function (err) {
    console.error('Could not connect or configure RabbitMQ:', err);
  });
};
