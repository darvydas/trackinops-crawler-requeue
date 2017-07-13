# Base docker node image
FROM node:7

## PART 1: Core components
## =======================

# Create app directory
RUN mkdir -p /usr/src/app/trackinops-crawler-requeue
WORKDIR /usr/src/app/trackinops-crawler-requeue

# Download TrackinOps from git source.
# RUN git clone https://github.com/darvydas/trackinops-crawler-requeue /usr/src/app/trackinops-crawler-requeue &&\
# #cd /trackinops-crawler-requeue &&\
# git checkout tags/v0.1 &&\
# npm install

# Build TrackinOps from source locally.
COPY . /usr/src/app/trackinops-crawler-requeue
RUN npm install

# EXPOSE 3000
CMD NODE_ENV=production node --max_old_space_size=4096 index.js