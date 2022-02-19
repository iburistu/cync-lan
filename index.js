"use strict";

const fastify = require("fastify")({
  logger: true,
});
const tls = require("tls");
const fs = require("fs");
const Buffer = require("buffer").Buffer;

const TLS_PORT = 23779;
const TLS_HOST = "0.0.0.0";

const API_PORT = 8080;
const API_HOST = "0.0.0.0";

const options = {
  key: fs.readFileSync("certs/key.pem"),
  cert: fs.readFileSync("certs/cert.pem"),
};

let iter = 0;

const SERVER_ITER_RESPONSE = () =>
  Buffer.from([0x88, 0x00, 0x00, 0x00, 0x03, 0x00, ++iter, 0x00]);

const CLIENT_INFO_BUFFER = Buffer.from([0x23]);
const SERVER_CLIENT_ACK = Buffer.from([
  0x28, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00,
]);
const CLIENT_CONNECTION_REQUEST = Buffer.from([
  0xc3, 0x00, 0x00, 0x00, 0x01, 0x0c,
]);
const SERVER_CONNECTION_RESPONSE = Buffer.from([
  0xc8, 0x00, 0x00, 0x00, 0x0b, 0x0d, 0x07, 0xe6, 0x02, 0x13, 0x07, 0x0a, 0x14,
  0x29, 0xfd, 0xa8,
]);
const CLIENT_DATA = Buffer.from([0x43, 0x00, 0x00, 0x00]);
const SERVER_CLIENT_DATA_ACK = Buffer.from([
  0x48, 0x00, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00,
]);
const CLIENT_ITER_REQUEST = Buffer.from([0x83]);
const CLIENT_HEARTBEAT = Buffer.from([0xd3, 0x00, 0x00, 0x00, 0x00]);
const SERVER_HEARTBEAT = Buffer.from([0xd8, 0x00, 0x00, 0x00, 0x00]);

const CMD_TURN_ON = Buffer.from([
  0x73, 0x00, 0x00, 0x00, 0x1f, 0x2a, 0x1a, 0xe1, 0xe0, 0x48, 0x78, 0x00, 0x7e,
  0x00, 0x01, 0x00, 0x00, 0xf8, 0xd0, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0xd0, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
]);
const CMD_TURN_OFF = Buffer.from([
  0x73, 0x00, 0x00, 0x00, 0x1f, 0x2a, 0x1a, 0xe1, 0xe0, 0x48, 0x7c, 0x00, 0x7e,
  0x00, 0x01, 0x00, 0x00, 0xf8, 0xd0, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const CLIENT_STATUS_ON = Buffer.from([
  0x7b, 0x00, 0x00, 0x00, 0x07, 0x2a, 0x1a, 0xe1, 0xe0, 0x48, 0x78, 0x00,
]);
const CLIENT_STATUS_OFF = Buffer.from([
  0x7b, 0x00, 0x00, 0x00, 0x07, 0x2a, 0x1a, 0xe1, 0xe0, 0x48, 0x7c, 0x00,
]);

let devices = [];

const server = tls.createServer(options);

server.on("error", function (error) {
  fastify.log.error(error);
  server.destroy();
});

const sendTCPData = (sock, data) =>
  new Promise((resolve, reject) => {
    try {
      if (
        !sock.write(data, (err) => {
          if (err) reject(err);
          resolve();
        })
      ) {
        sock.once("drain", resolve);
      } else {
        process.nextTick(resolve);
      }
    } catch (e) {
      reject(e);
    }
  });

server.on("secureConnection", (socket) => {
  fastify.log.info(
    `New connection: ${socket.remoteAddress}:${socket.remotePort}`
  );
  devices.push(socket);

  socket.on("data", async (data) => {
    fastify.log.info(`Client sent: ${data.toString("hex")}`);

    if (data.subarray(0, 1).equals(CLIENT_INFO_BUFFER)) {
      await sendTCPData(socket, SERVER_CLIENT_ACK);
      fastify.log.info(`Server sent: ${SERVER_CLIENT_ACK.toString("hex")}`);
    }
    if (data.equals(CLIENT_CONNECTION_REQUEST)) {
      await sendTCPData(socket, SERVER_CONNECTION_RESPONSE);
      fastify.log.info(
        `Server sent: ${SERVER_CONNECTION_RESPONSE.toString("hex")}`
      );
    }
    if (data.subarray(0, 4).equals(CLIENT_DATA)) {
      await sendTCPData(socket, SERVER_CLIENT_DATA_ACK);
      fastify.log.info(
        `Server sent: ${SERVER_CLIENT_DATA_ACK.toString("hex")}`
      );
    }
    if (data.equals(CLIENT_HEARTBEAT)) {
      await sendTCPData(socket, SERVER_HEARTBEAT);
      fastify.log.info(`Server sent: ${SERVER_HEARTBEAT.toString("hex")}`);
    }
    if (data.subarray(0, 1).equals(CLIENT_ITER_REQUEST)) {
      const buf = SERVER_ITER_RESPONSE();
      await sendTCPData(socket, buf);
      fastify.log.info(`Server sent: ${buf.toString("hex")}`);
    }
    if (data.equals(CLIENT_STATUS_ON)) {
      fastify.log.info(
        `${socket.remoteAddress}:${socket.remotePort} is now ON`
      );
    }
    if (data.equals(CLIENT_STATUS_OFF)) {
      fastify.log.info(
        `${socket.remoteAddress}:${socket.remotePort} is now OFF`
      );
    }
  });

  socket.on("close", () => {
    let idx = devices.findIndex(
      (e) => e.remoteAddress === socket.remoteAddress && e.remotePort === socket
    );
    if (idx > 0) devices.splice(idx, 1);
    fastify.log.info(
      `Connection closed: ${socket.remoteAddress}:${socket.remotePort}`
    );
  });

  socket.on("end", function () {
    fastify.log.info(`EOT: ${socket.remoteAddress}:${socket.remotePort}`);
  });
});

const opts = {
  schema: {
    body: {
      type: "object",
      properties: {
        status: { type: ["string", "number"] },
      },
      required: ["status"],
    },
    params: {
      type: "object",
      properties: {
        IP: { type: "string" },
      },
      required: ["IP"],
    },
  },
};

fastify.post("/:IP", opts, async (req, res) => {
  try {
    const {
      body: { status },
      params: { IP },
    } = req;
    let idx = devices.findIndex((e) => e.remoteAddress === IP);
    if (idx < 0) throw new Error("Not found");
    switch (status) {
      case "on":
      case 1:
      case "1":
        await sendTCPData(devices[idx], CMD_TURN_ON);
        break;

      case "off":
      case 0:
      case "0":
        await sendTCPData(devices[idx], CMD_TURN_OFF);
        break;

      default:
        break;
    }
    return {
      status,
    };
  } catch (e) {
    res.statusCode = 404;
    return res;
  }
});

fastify.listen(API_PORT, API_HOST, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  server.listen(TLS_PORT, TLS_HOST, function () {
    fastify.log.info(`TLS server listening on ${TLS_HOST}:${TLS_PORT}`);
  });
});
