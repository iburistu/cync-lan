# cync-lan

Proof-of-concept LAN controller for CYNC devices.

## Prerequisites:

Because this works by re-routing DNS traffic to your local network, you'll need some way to route DNS - a local DNS server, Pi-Hole, or `/etc/hosts` file on your router will work. You'll also need Node 16 LTS or greater, as well as `openssl`. You may also need `dig` and `socat` for debugging.

## Installation:

Make sure you have `openssl` installed before installing any npm packages. A `postinstall` script automagically generates a self-signed key & certificate needed to decrypt the CYNC device traffic.

To install the necessary NPM packages, run:

```sh
npm i
```

## Re-routing DNS

You need to point the domain `cm.gelighting.com` to a local IP on your network. This server masquerades as the `cm.gelighting.com` TCP server, and the `cm.gelighting.com` domain is hardcoded into the device firmware, so we need to re-route the traffic manually. I was able to do this by modifying the local DNS setting of my Pi-hole to map `cm.gelighting.com` to `10.0.0.4`, but YMMV depending on your network setup.

> [!NOTE]  
> Some of the most recent firmware for Cync devices is able to identify that a DNS route to private address space is invalid, and instead will refuse to connect. Confirmed affected devices and firmware:
> - Direct Connect White Smart Bulb v1.0.241
> 
> If your device refuses to connect to the local server after DNS rerouting, two options are available:
> 1. Reroute the DNS to your public IPv4 address and port forward TCP 23779 from your router (not sure if this stays local or if it's a hairpin turn - your router might be smart enough to not have it exit and come back? IDK)
> 2. If you are behind CGNAT (like I am), you'll need to use SNAT + DNAT rules on your router to change the source and destination of packets that should be headed to the Cync servers. Here's a few `iptables` rules that I use:
> ```sh
> iptables -t nat -I PREROUTING -i br0 -s 10.0.0.0/22 -d 35.196.85.236 -j DNAT --to-destination 10.0.0.4
> iptables -t nat -I POSTROUTING -o br0 -s 10.0.0.0/22 -d 10.0.0.4/32 -j SNAT --to-source 192.168.0.1-192.168.0.254
> ```
> The `cync-lan` host is 10.0.0.4. The Cync server is 35.196.85.236. The Cync devices show up to the `cync-lan` host as IPs in 192.168.0.1/24, and can be directly controlled using the IPs returned.

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
curl -X POST 'http://192.168.1.1:8080/api/devices/192.168.1.2' -H 'Content-Type: application/json' -d '{"status":1}'
```

`status` is a required body property, and to turn the device on you can set it's value as

- 1
- "1"
- "on"

To turn the device off, you can set `status` to 

- 0
- "0"
- "off"

Other body options include:

- brightness: set in between `0`-`100`
- temperature: for non-RGB bulbs with color options you can set the color temp from `0` (candlelight) to `100` (sunlight)
- color: for RGB bulbs you can set the R, G, B, and saturation (S) from `0`-`255`. `0` saturation is most saturated, and `255` is pure white (confusing, but it's how they set it up!)

An API route at `/api/devices` returns connected devices.

```sh
curl http://192.168.1.1:8080/api/devices
```

## Debugging:

If the commands do not seem to be working, it's likely that the TCP communication on your device is different than mine. You can inspect the traffic of the device communicating with the `cm.gelighting.com` server in real-time by running:

```sh
socat -d -d -lf /dev/stdout -x -v 2> dump.txt ssl-l:23779,reuseaddr,fork,cert=certs/server.pem,verify=0 openssl:35.196.85.236:23779,verify=0
```

The TCP data will be streamed to `dump.txt` where you can observe the back-and-forth messaging. You may need to modify the different `Buffer` values in the code to better suit your needs.

Also make sure to check that your DNS re-route is actually routing to your local network. You can check by using `dig`:

```sh
dig cm.gelighting.com
```

You should see an A record for your local network. If not, your DNS is not set up correctly.

Additionally, the devices make the DNS query on startup - you need to cycle power for all devices on the network for them to use your local server.

To debug the server code and print out additional diagnostic data, set the `CYNC_DEBUG` environment variable to `1`, e.g.

```sh
CYNC_DEBUG=1 node index.js
```