# cync-lan

Proof-of-concept LAN controller for CYNC 120V smart plug devices.

## Prerequisites:

Because this works by re-routing DNS traffic to your local network, you'll need some way to route DNS - a local DNS server, Pi-Hole, or `/etc/hosts` file on your router will work. You'll also need Node 16 LTS or greater, as well as `openssl`. You may also need `dig` and `socat` for debugging.

## Installation:

Make sure you have `openssl` installed before installing any npm packages. A `postinstall` script automagically generates a self-signed key & certificate needed to decrypt the CYNC device traffic.

To install the necessary NPM packages, run:

```sh
npm i
```

## Re-routing DNS

You need to point the domain `cm-ge.xlink.cn` to a local IP on your network. This server masquerades as the `cm-ge.xlink.cn` TCP server, and the `cm-ge.xlink.cn` domain is hardcoded into the device firmware, so we need to re-route the traffic manually. I was able to do this by modifying the local DNS setting of my Pi-hole to map `cm-ge.xlink.cn` to `192.168.1.1`, but YMMV depending on your network setup.

## Launching the server

I found it easiest to first start the server, then turn on or plug in the device. 

To start the server, just run:

```sh
npm run start
```

If you're correctly routing the DNS traffic, you should see a new connection appearing in the logs. Take note of the IP shown - you need that to control the state of the device.

## Controlling devices:

Devices are controlled by sending a POST request with a JSON body to the API server with a path parameter of the IP of the device you want to control. For example, if I have a device on `192.168.1.2`, and the API server's IP is `192.168.1.1`, to turn that device on, you can run:

```sh
curl -X POST 'http://192.168.1.1:8080/192.168.1.2' -H 'Content-Type: application/json' -d '{"status":1}'
```

`status` is a required body property, and to turn the device on you can set it's value as

- 1
- "1"
- "on"

To turn the device off, you can set `status` to 

- 0
- "0"
- "off"

## Debugging:

If the commands do not seem to be working, it's likely that the TCP communication on your device is different than mine. You can inspect the traffic of the device communicating with the `cm-ge.xlink.cn` server in real-time by running:

```sh
socat -d -d -lf /dev/stdout -x -v 2> dump.txt ssl-l:23779,reuseaddr,fork,cert=certs/server.pem,verify=0 openssl:34.73.130.191:23779,verify=0
```

The TCP data will be streamed to `dump.txt` where you can observe the back-and-forth messaging. You may need to modify the different `Buffer` values in the code to better suit your needs.

Also make sure to check that your DNS re-route is actually routing to your local network. You can check by using `dig`:

```sh
dig cm-ge.xlink.cn
```

You should see an A record for your local network. If not, your DNS is not set up correctly.