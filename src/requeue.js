// initialize RabbitMQ connection
const Queue = require("./rabbitmq");
// create Exchange, Queue, Binding for Trackinops reQueue
Queue.initTopology().then(function () {
  // start message requeue to deal with urls from parsed pages
  Queue.startRequeueSubscription();
});