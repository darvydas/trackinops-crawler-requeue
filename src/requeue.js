// initialize NSQ connection
const Queue = require("./nsq");
// start message requeue to deal with urls from parsed pages
Queue.startRequeueSubscription();

process.on('uncaughtException', function (err) {
  console.error('uncaughtException: ', err.message)
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev') {
    console.error(err.stack)
  }
  process.exit(1);
})