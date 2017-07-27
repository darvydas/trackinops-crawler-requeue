// initialize NSQ connection
const Queue = require("./nsq");
// start message requeue to deal with urls from parsed pages
Queue.startRequeueSubscription();
