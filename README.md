RendezvousPoint.js
===================
Creates an internet facing Rendezvous Point to bypass firewalls and forward traffic into a target network - Created by [Ash47](https://GitHub.com/Ash47)

## Quick Summary
  - This script is used to port forward from behind two different Firewalls via an internet facing rendezvous point

## How does it work?
  - A client connects via TLS to the endpoint, and sends a message to say if it's looking to connect (Client A), or if it's accepting connections (CLient B)
  - The clients need to send this message along with a PSK within a predefined time or they will be dropped
  - Once we have at least one of client A and client B, client A will be told there is a connection, and the pipes will be connected
  - Client A will then send through a message that instructs client B what to connect to
  - Client B will attempt to connect to the destination, and then connect the pipes together

## How to run it?
  - Install [NodeJS](https://nodejs.org/en/)
  - Configure two clients, samples below
  - Run `node index.js` for the server, and both clients

## How do I see stats / info?
  - You can review the server's console log which will log out how many active connections there are
  - You can run the client with GateWay mode off, which will tell you how many connections there are, and dump a list of hostnames and IPs / networks that are available

## How to run on system startup?
  - Windows: Create a scheduled task to run the `run.bat` file on startup, and allow it to run even without the user logging in
  - Linux: Some kind of boot script? Good luck, too many distros

## Config
   - `server/config.js` - This contains the configuration of the server itself
     - `ingestPort` - Which port to listen on for connections
     - `maxAuthTime` - Max time in ms before a connection will be killed if it didn't send the PSK
     - `tlsOptions` - Location of the `cert` and `key` used for the TLS connection, a default one has been provided in `certs`
     - `psk` - The preshared key which needs to exist on all clients
  - `client/config.js`
    - `isGateway` - If true, this client will act as an outgoing gateway, and route the forwarded connections, if false, this client will bind to the ports defined in `portForwards` and try to connect to the hosts / ports via another gateway
    - `gatewayThreads` - When in gateway mode, this is how many unused connections we will maintain to the RV point
    - `tryAllInterfaces` - Automatically cycle through every interface on the machine to find an active connection to the interface?
      - If it finds one that works, it will cache that interface until it starts to fail again
      - If this is false, it will just use your default interface, which generally won't update if your network connections change
    - `rvConfig` - Options for connecting to the RV point
      - `host` - The RV host to connect to
      - `port` - The RV port to connect to
      - `rejectUnauthorized` - If set to false, this won't validate TLS certs
    - `psk` - The PSK to send to the server to auth
    - `portForwards` - This is an object that is used to define what ports to listen on, and where to forward connections when `isGateway` is false, the key is a port (e.g. 8080), and the values are an object that define a host and port to connect to
        - `host` - Host to connect this listener to
        - `port` - Port to connect this listener to
        - `targetHostname` - Optional paramater which allows you to route via a specific endpoint for your port forward, if this is not defined, then the first available endpoint will be selected

## How do I edit the port forwards?
  - Edit the `portForwards` in the bind client, the server won't need to be reloaded, rather, new connections on the given port will route to the new server
  - You can add or remove servers
  - Existing connections are NOT affected
  - If forwarding to HTTPS servers, please note that modern servers keep the conneciton alive, so a simple F5 will NOT point to the new server, if the connection is kept alive

## Example Config - Server
```javascript
const fs = require('fs');

module.exports = {
    // Port that clients will connect to
    ingestPort: 3000,

    // How long a client has to successfully auth
    maxAuthTime: 5000, // in ms

    // Options for encryption
    tlsOptions: {
        cert: fs.readFileSync('./creds/cert.cert'),
        key: fs.readFileSync('./creds/key.key'),
    },

    // Must match client, or they can't connect
    psk: 'PutSomeKindOfAKeyHereToPreventHacking',
};
```

## Example Config - Gateway Client

```javascript
module.exports = {
    // Is this client a Gateway?
	isGateway: true,

	// Number of connections to have sitting in a pool ready for a connection
	gatewayThreads: 3,

  // Should we try every interface to reach the internet?
  tryAllInterfaces: true,
    
    // RV Point Info
	rvConfig: {
        // RV Host
        host: '127.0.0.1',
        
        // RV Port
		port: 3000,

		// Ignore TLS certs? false = accept all certs
		rejectUnauthorized: false,
	},

	// Preshared-Key -- Must match server, or ggwp
	psk: 'PutSomeKindOfAKeyHereToPreventHacking'
};
```

## Example Config - Connection / Bind Client
```javascript
module.exports = {
    // Is this client a Gateway?
	isGateway: false,

  // Should we try every interface to reach the internet?
  tryAllInterfaces: true,

	// RV Point Info
	rvConfig: {
        // RV Host
        host: '127.0.0.1',
        
        // RV Port
		port: 3000,

		// Ignore TLS certs? false = accept all certs
		rejectUnauthorized: false,
	},

    // Which ports are forwarded
	portForwards: {
		8080: {
			host: 'en.wikipedia.org',
			port: 443
		},

		8081: {
			host: 'nodejs.org',
			port: 443
		},

		8082: {
			host: '127.0.0.1',
			port: 12341
		}
	},

	// Preshared-Key -- Must match server, or ggwp
	psk: 'PutSomeKindOfAKeyHereToPreventHacking'
};
```