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

const DEBUG = Boolean(process.env.CYNC_DEBUG);

const options = {
    key: fs.readFileSync("certs/key.pem"),
    cert: fs.readFileSync("certs/cert.pem"),
};

// Some commands require a response that iterates a specific byte
// It appears it can be shared across all devices, but it should still
// be iterated
let iter = 0;
const CLIENT_ITER_REQUEST = Buffer.from([0x83]);
const SERVER_ITER_RESPONSE = () =>
    Buffer.from([0x88, 0x00, 0x00, 0x00, 0x03, 0x00, ++iter, 0x00]);

// The client sends along it's MAC address in the initial connection
// We don't care but it likes a response
const CLIENT_INFO_BUFFER = Buffer.from([0x23]);
const SERVER_CLIENT_ACK = Buffer.from([
    0x28, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00,
]);

// There is a specific handshake that needs to occur before the client
// will accept commands
const CLIENT_CONNECTION_REQUEST = Buffer.from([
    0xc3, 0x00, 0x00, 0x00, 0x01, 0x0c,
]);
const SERVER_CONNECTION_RESPONSE = Buffer.from([
    0xc8, 0x00, 0x00, 0x00, 0x0b, 0x0d, 0x07, 0xe6, 0x02, 0x13, 0x07, 0x0a,
    0x14, 0x29, 0xfd, 0xa8,
]);

// The client will sometimes send diagnostic data - acknowledge it
const CLIENT_DATA = Buffer.from([0x43, 0x00, 0x00, 0x00]);
const SERVER_CLIENT_DATA_ACK = Buffer.from([
    0x48, 0x00, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00,
]);

// Clients get fussy if they don't hear from the server frequently
const CLIENT_HEARTBEAT = Buffer.from([0xd3, 0x00, 0x00, 0x00, 0x00]);
const SERVER_HEARTBEAT = Buffer.from([0xd8, 0x00, 0x00, 0x00, 0x00]);

const CMD_TURN_ON = Buffer.from([
    0x73, 0x00, 0x00, 0x00, 0x1f, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x7e, 0x00, 0x00, 0x00, 0x00, 0xf8, 0xd0, 0x0d, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xd0, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
]);
const CMD_TURN_OFF = Buffer.from([
    0x73, 0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x7e, 0x00, 0x00, 0x00, 0x00, 0xf8, 0xd0, 0x0d, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const CMD_SET_BRIGHTNESS = (brightness) =>
    Buffer.from([
        0x73,
        0x00,
        0x00,
        0x00,
        0x1d,
        0x03,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x7e,
        0x00,
        0x00,
        0x00,
        0x00,
        0xf8,
        0xd2,
        0x0b,
        0x00,
        0x00,
        0x01,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xd2,
        0x00,
        0x00,
        brightness,
        0x00,
        0x00,
    ]);
const CMD_SET_COLOR_TEMPERATURE = (W) =>
    Buffer.from([
        0x73,
        0x00,
        0x00,
        0x00,
        0x1e,
        0x04,
        0x1a,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x7e,
        0x00,
        0x00,
        0x00,
        0x00,
        0xf8,
        0xe2,
        0x0c,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xe2,
        0x00,
        0x00,
        0x05,
        W,
        0x00,
        0x00,
    ]);

const CMD_SET_COLOR = (R, G, B, S) =>
    Buffer.from([
        0x73,
        0x00,
        0x00,
        0x00,
        0x20,
        0x05,
        0x1a,
        0x00,
        0x0,
        0x00,
        0x00,
        0x00,
        0x7e,
        0x00,
        0x00,
        0x00,
        0x00,
        0xf8,
        0xe2,
        0x0e,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xe2,
        0x00,
        0x00,
        0x04,
        R,
        G,
        B,
        S,
        0x00,
    ]);

// Some commands have a "return" code that we can use to make sure
// the state of devices stays in sync
const CLIENT_STATUS_ON = Buffer.from([
    0x7b, 0x00, 0x00, 0x00, 0x07, 0x01, 0x00, 0x00, 0x00,
]);
const CLIENT_STATUS_OFF = Buffer.from([
    0x7b, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00,
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

    // All the back & forth init communication is handled here
    socket.on("data", async (data) => {
        DEBUG && fastify.log.info(`Client sent: ${data.toString("hex")}`);

        if (data.subarray(0, 1).equals(CLIENT_INFO_BUFFER)) {
            await sendTCPData(socket, SERVER_CLIENT_ACK);
            DEBUG &&
                fastify.log.info(
                    `Server sent: ${SERVER_CLIENT_ACK.toString("hex")}`
                );
        }
        if (data.equals(CLIENT_CONNECTION_REQUEST)) {
            await sendTCPData(socket, SERVER_CONNECTION_RESPONSE);
            DEBUG &&
                fastify.log.info(
                    `Server sent: ${SERVER_CONNECTION_RESPONSE.toString("hex")}`
                );
        }
        if (data.subarray(0, 4).equals(CLIENT_DATA)) {
            await sendTCPData(socket, SERVER_CLIENT_DATA_ACK);
            DEBUG &&
                fastify.log.info(
                    `Server sent: ${SERVER_CLIENT_DATA_ACK.toString("hex")}`
                );
        }
        if (data.equals(CLIENT_HEARTBEAT)) {
            await sendTCPData(socket, SERVER_HEARTBEAT);
            DEBUG &&
                fastify.log.info(
                    `Server sent: ${SERVER_HEARTBEAT.toString("hex")}`
                );
        }
        if (data.subarray(0, 1).equals(CLIENT_ITER_REQUEST)) {
            const buf = SERVER_ITER_RESPONSE();
            await sendTCPData(socket, buf);
            DEBUG && fastify.log.info(`Server sent: ${buf.toString("hex")}`);
        }
        if (data.subarray(0, 9).equals(CLIENT_STATUS_ON)) {
            DEBUG &&
                fastify.log.info(
                    `${socket.remoteAddress}:${socket.remotePort} is now ON`
                );
        }
        if (data.subarray(0, 9).equals(CLIENT_STATUS_OFF)) {
            DEBUG &&
                fastify.log.info(
                    `${socket.remoteAddress}:${socket.remotePort} is now OFF`
                );
        }
    });

    socket.on("close", () => {
        let idx = devices.findIndex(
            (e) =>
                e.remoteAddress === socket.remoteAddress &&
                e.remotePort === socket
        );
        if (idx > 0) devices.splice(idx, 1);
        fastify.log.info(
            `Connection closed: ${socket.remoteAddress}:${socket.remotePort}`
        );
    });

    socket.on("end", function () {
        fastify.log.info(`EOT: ${socket.remoteAddress}:${socket.remotePort}`);
    });

    socket.on("error", (err) => {
        fastify.log.error(err);
    });
});

const opts = {
    schema: {
        body: {
            type: "object",
            properties: {
                status: { type: ["string", "number"] },
                brightness: {
                    type: ["string", "number"],
                },
                temperature: { type: ["string", "number"] },
                color: {
                    type: "object",
                    properties: {
                        R: { type: ["string", "number"] },
                        G: { type: ["string", "number"] },
                        B: { type: ["string", "number"] },
                        S: { type: ["string", "number"] },
                    },
                },
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
        let {
            body: { brightness, color, status, temperature },
            params: { IP },
        } = req;

        let idx = devices.findIndex((e) => e.remoteAddress === IP);
        if (idx < 0) throw new Error();
        const sock = devices[idx];

        switch (status) {
            case "on":
            case 1:
            case "1":
                await sendTCPData(sock, CMD_TURN_ON);
                break;

            case "off":
            case 0:
            case "0":
                await sendTCPData(sock, CMD_TURN_OFF);
                break;

            default:
                break;
        }

        if (brightness) {
            await sendTCPData(sock, CMD_SET_BRIGHTNESS(Number(brightness)));
        }

        if (temperature) {
            await sendTCPData(
                sock,
                CMD_SET_COLOR_TEMPERATURE(Number(temperature))
            );
        }

        if (color) {
            await sendTCPData(
                sock,
                CMD_SET_COLOR(
                    Number(color.R),
                    Number(color.G),
                    Number(color.B),
                    Number(color.S)
                )
            );
        }

        return {
            status,
            brightness,
            temperature,
            color,
        };
    } catch (e) {
        res.statusCode = 404;
        return e;
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
