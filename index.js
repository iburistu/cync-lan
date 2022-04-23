"use strict";

const fastify = require("fastify")({
    logger: true,
});

fastify.register(require("fastify-cors"), {
    origin: "*",
});

const tls = require("tls");
const fs = require("fs");
const Buffer = require("buffer").Buffer;

const TLS_PORT = 23779;
const TLS_HOST = "0.0.0.0";

const API_PORT = process.env.CYNC_API_PORT || 8080;
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
    Buffer.from([0x88, 0x00, 0x00, 0x00, 0x03, 0x00, ++iter % 0xff, 0x00]);

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
        0x02,
        brightness,
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
        0x03,
        W,
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

const CMD_SET_COLOR = (R, G, B) =>
    Buffer.from([
        0x73,
        0x00,
        0x00,
        0x00,
        0x20,
        0x04,
        R,
        G,
        B,
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
        0x00,
        0x00,
    ]);

// Some commands have a "return" code that we can use to make sure
// the state of devices stays in sync
const CLIENT_STATUS_ON = Buffer.from([0x7b, 0x00, 0x00, 0x00, 0x07, 0x01]);
const CLIENT_STATUS_OFF = Buffer.from([0x7b, 0x00, 0x00, 0x00, 0x07, 0x00]);

const CLIENT_STATUS_BRIGHTNESS = Buffer.from([
    0x7b, 0x00, 0x00, 0x00, 0x07, 0x02,
]);

const CLIENT_STATUS_TEMPERATURE = Buffer.from([
    0x7b, 0x00, 0x00, 0x00, 0x07, 0x03,
]);

const INITIAL_CLIENT_STATE = Buffer.from([0x43, 0x00, 0x00, 0x00]);

let devices = {};

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
    devices[socket.remoteAddress] = {
        socket: socket,
        state: {},
    };

    // All the back & forth init communication is handled here
    socket.on("data", async (data) => {
        DEBUG &&
            fastify.log.info(
                `${socket.remoteAddress}:${
                    socket.remotePort
                } sent: ${data.toString("hex")}`
            );

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
        if (data.subarray(0, 6).equals(CLIENT_STATUS_ON)) {
            DEBUG &&
                fastify.log.info(
                    `${socket.remoteAddress}:${socket.remotePort} is now ON`
                );
            devices[socket.remoteAddress].state.status = true;
        }
        if (data.subarray(0, 6).equals(CLIENT_STATUS_OFF)) {
            DEBUG &&
                fastify.log.info(
                    `${socket.remoteAddress}:${socket.remotePort} is now OFF`
                );
            devices[socket.remoteAddress].state.status = false;
        }
        if (data.includes(CLIENT_STATUS_BRIGHTNESS)) {
            const idx = data.indexOf(CLIENT_STATUS_TEMPERATURE);
            DEBUG &&
                fastify.log.info(
                    `${socket.remoteAddress}:${
                        socket.remotePort
                    } has a brightness of ${Number(data[idx + 7])}`
                );
            devices[socket.remoteAddress].state.brightness = Number(
                data[idx + 7]
            );
        }
        if (data.includes(CLIENT_STATUS_TEMPERATURE)) {
            const idx = data.indexOf(CLIENT_STATUS_TEMPERATURE);
            DEBUG &&
                fastify.log.info(
                    `${socket.remoteAddress}:${
                        socket.remotePort
                    } has a temperature of ${Number(data[idx + 6])}`
                );
            devices[socket.remoteAddress].state.temperature = Number(
                data[idx + 6]
            );
        }
        if (data.subarray(0, 4).equals(INITIAL_CLIENT_STATE) && (data[5] !== 0x1e)) {
            const rawState = data.subarray(15, 22);
            switch (rawState.subarray(0, 1).toString("hex")) {
                case "01": {
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${socket.remotePort} is a smart plug`
                        );
                    const state = Boolean(
                        parseInt(rawState.subarray(1, 2).toString("hex"), 16)
                    );
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${
                                socket.remotePort
                            } is currently ${state ? "on" : "off"}!`
                        );
                    devices[socket.remoteAddress].state = {
                        type: "plug",
                        status: state,
                    };
                    break;
                }

                case "02": {
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${socket.remotePort} is a smart light`
                        );
                    const state = Boolean(
                        parseInt(rawState.subarray(1, 2).toString("hex"), 16)
                    );
                    const brightness = parseInt(
                        rawState.subarray(2, 3).toString("hex"),
                        16
                    );
                    const temperature = parseInt(
                        rawState.subarray(3, 4).toString("hex"),
                        16
                    );
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${
                                socket.remotePort
                            } is currently ${
                                state ? "on" : "off"
                            } and has a brightness of ${brightness} and color temp of ${temperature}`
                        );
                    devices[socket.remoteAddress].state = {
                        type: "light",
                        status: state,
                        brightness,
                        temperature,
                    };
                    break;
                }

                case "04": {
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${socket.remotePort} is a light strip!`
                        );
                    const state = Boolean(
                        parseInt(rawState.subarray(1, 2).toString("hex"), 16)
                    );
                    const brightness = parseInt(
                        rawState.subarray(2, 3).toString("hex"),
                        16
                    );
                    const r = parseInt(
                        rawState.subarray(4, 5).toString("hex"),
                        16
                    );
                    const g = parseInt(
                        rawState.subarray(5, 6).toString("hex"),
                        16
                    );
                    const b = parseInt(
                        rawState.subarray(6, 7).toString("hex"),
                        16
                    );
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${
                                socket.remotePort
                            } is currently ${
                                state ? "on" : "off"
                            } and has a brightness of ${brightness} and color of (${r},${g},${b})`
                        );
                    devices[socket.remoteAddress].state = {
                        type: "lightstrip",
                        status: state,
                        brightness,
                        color: {
                            r,
                            g,
                            b,
                        },
                    };
                    break;
                }

                default:
                    DEBUG &&
                        fastify.log.info(
                            `${socket.remoteAddress}:${socket.remotePort} is an unknown device...`
                        );
                    break;
            }
        }
    });

    socket.on("close", () => {
        delete devices[socket.remoteAddress];
        fastify.log.info(
            `Connection closed: ${socket.remoteAddress}:${socket.remotePort}`
        );
    });

    socket.on("end", function () {
        delete devices[socket.remoteAddress];
        fastify.log.info(`EOT: ${socket.remoteAddress}:${socket.remotePort}`);
    });

    socket.on("error", (err) => {
        delete devices[socket.remoteAddress];
        fastify.log.error(err);
    });

    socket.on("timeout", () => {
        delete devices[socket.remoteAddress];
        fastify.log.info(
            `Timeout: ${socket.remoteAddress}:${socket.remotePort}`
        );
    });
});

const params = {
    type: "object",
    properties: {
        IP: { type: "string" },
    },
    required: ["IP"],
};

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
                        r: { type: ["string", "number"] },
                        g: { type: ["string", "number"] },
                        b: { type: ["string", "number"] },
                    },
                },
            },
        },
        params,
    },
};

fastify.post("/api/devices/:IP", opts, async (req, res) => {
    try {
        let {
            body: { brightness, color, status, temperature },
            params: { IP },
        } = req;

        if (!(IP in devices)) throw new Error("Not found");
        const sock = devices[IP].socket;

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
                    Number(color.r),
                    Number(color.g),
                    Number(color.b)
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

fastify.get("/api/devices", async (req, res) => {
    try {
        return Object.keys(devices);
    } catch (e) {
        res.statusCode = 400;
        return e;
    }
});

fastify.get("/api/devices/:IP", { schema: { params } }, async (req, res) => {
    try {
        const {
            params: { IP },
        } = req;
        if (!(IP in devices)) throw new Error("Not found");

        return devices[IP].state;
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
