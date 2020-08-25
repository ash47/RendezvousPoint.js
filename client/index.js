const tls = require('tls');
const net = require('net');
const fs = require('fs');

const configFile = './config.js';
let config = require(configFile);

// List of servers that are currently running, key = port
const currentServers = {};

function tryPortForward(callback, connectToInfo) {
    let doneCallback = false;

    const socket = tls.connect(config.rvConfig, () => {
        console.log('[+] Connected to ' + config.rvConfig.host + ':' + config.rvConfig.port);

        // Ensure cleanup
        if (doneCallback) {
            socket.end();
        }
    });

    socket.on('error', (err) => {
        if (doneCallback) return;
        doneCallback = true;

        // Fire callback
        callback(err);
    });

    socket.on('end', () => {
        if (doneCallback) return;
        doneCallback = true;

        callback(new Error('ended'));
    });

    // Create store for data
    socket.cachedData = Buffer.from([]);
    socket.on('data', (data) => {
        // Merge new data onto the stack
        socket.cachedData = Buffer.concat([socket.cachedData, data]);

        // We need 4 bytes for the header
        if (socket.cachedData.length < 4) return;

        // How big is the message?
        const messageLen = socket.cachedData.readInt32BE(0);

        // Do we have the entire message?
        if (socket.cachedData.length < messageLen + 4) return;

        // Pull this message off the stack
        const thisMessage = socket.cachedData.slice(4, messageLen + 4);

        // Remove this message from the stack
        socket.cachedData = socket.cachedData.slice(messageLen + 4);

        // Process message
        let niceMessage = null;
        try {
            niceMessage = JSON.parse(thisMessage);
        } catch (e) {
            console.log(e);
            // broken, kill socket
            socket.end();

            if (doneCallback) return;
            doneCallback = true;

            callback(new Error('socket unknown state'));

            return;
        }

        // Unhook data event
        socket.removeAllListeners('data');
        socket.pause();

        // Process events
        if (niceMessage.hasOwnProperty('action') && typeof (niceMessage.action) === 'string') {
            const thisAction = niceMessage.action;

            if (connectToInfo) {
                switch (thisAction) {
                    case 'connected':
                        // We are now connected
                        sendMessage(socket, {
                            action: 'connectTo',
                            host: connectToInfo.host,
                            port: connectToInfo.port,
                        });

                        if (doneCallback) return;
                        doneCallback = true;

                        // Run callback
                        callback(null, socket);
                        return;
                }
            } else {
                switch (thisAction) {
                    case 'connectTo':
                        if (doneCallback) return;
                        doneCallback = true;

                        callback(null, socket, niceMessage);
                        return;
                }
            }
        }

        if (doneCallback) return;
        doneCallback = true;

        // Ensure socket is dead
        socket.end();

        callback(new Error('socket unknown state'));
    });

    const toSend = {
        psk: config.psk
    };

    // Are we connecting, or being connected to?
    if (connectToInfo) {
        toSend.action = 'connectMe';
    } else {
        toSend.action = 'connectToMe';
    }

    // Send it
    sendMessage(socket, toSend);
}

function sendMessage(socket, dataObject) {
    // Convert the data object into a buffer, craete header
    const toSend = Buffer.from(JSON.stringify(dataObject));
    const header = Buffer.from([0, 0, 0, 0]);

    // The header contains how big the message is, write it
    header.writeInt32BE(toSend.length);

    // Create a buffer with the final payload
    const finalBuff = Buffer.concat([header, toSend]);

    // Send it
    socket.write(finalBuff);
}

function portForwardClientLoop() {
    // Logging
    console.log('[+] Waiting for a connection...');

    tryPortForward((err, connectedSocket, forwardInfo) => {
        // Start next port forward loop
        portForwardClientLoop();

        // If an error, stop here
        if (err) {
            return;
        }

        // Validate data
        if(typeof(forwardInfo) !== 'object' || typeof(forwardInfo.host) !== 'string' || typeof(forwardInfo.port) !== 'number') {
            connectedSocket.end();
            return;
        }

        // Log it
        console.log('[+] Been told to connect to ' + forwardInfo.host + ':' + forwardInfo.port);

        // We have a socket that is connected! Woot!
        const forwardConnection = net.createConnection({
            host: forwardInfo.host,
            port: forwardInfo.port
        }, () => {
            // Connected, pipe data into each other
            console.log('[+] Connected to ' + forwardInfo.host + ':' + forwardInfo.port);

            // Write anything that is left in the cache
            connectedSocket.write(connectedSocket.cachedData);

            forwardConnection.pipe(connectedSocket);
            connectedSocket.pipe(forwardConnection);

            // Resume socket
            connectedSocket.resume();
        });

        // Handle errors
        forwardConnection.on('error', () => {
            connectedSocket.end();
        });

        connectedSocket.on('error', () => {
            forwardConnection.end();
        });

        // Handle disconect
        forwardConnection.on('end', () => {
            connectedSocket.end();
        });

        connectedSocket.on('end', () => {
            forwardConnection.end();
        });
    });
}

function portForwardServer(bindPort) {
    const ourServer = net.createServer((socket) => {
        socket.on('error', () => {
            socket.didDie = true;
        });

        socket.on('end', () => {
            socket.didDie = true;
        });

        // If we don't have information on this, kill it
        if (!currentServers.hasOwnProperty(bindPort)) {
            console.log('[-] Unknown bind port ' + bindPort);
            socket.end();
            return;
        }

        // Host and port to connect to
        const theHost = currentServers[bindPort].host;
        const thePort = currentServers[bindPort].port;

        // We got a connection
        console.log('[+] Got a connection on port ' + bindPort + ', trying to connect to ' + theHost + ':' + thePort);

        tryPortForward((err, connectedSocket) => {
            if (err) {
                console.log(err);
                socket.end();
                return;
            }

            // Did we already die?
            if (socket.didDie) {
                connectedSocket.end();
                return;
            }

            console.log('[+] Connection completed!');

            // Connected! Pipe stuff together

            // Handle errors
            socket.on('error', () => {
                connectedSocket.end();
            });

            connectedSocket.on('error', () => {
                socket.end();
            });

            // Handle disconnect
            socket.on('end', () => {
                connectedSocket.end();
            });

            connectedSocket.on('end', () => {
                socket.end();
            });

            // Pipe data together
            socket.on('data', (data) => {
                connectedSocket.write(data);
            });

            connectedSocket.on('data', (data) => {
                socket.write(data);
            });

            // Resume socket
            connectedSocket.resume();
        }, {
            host: theHost,
            port: thePort,
        });
    });

    // Store server
    currentServers[bindPort].server = ourServer;

    ourServer.on('error', (err) => {
        console.log(err);
    });

    ourServer.listen(bindPort, () => {
        console.log('[+] server bound to port ' + bindPort);
    });
}

function refreshPortForwardServerConfig() {
    // Clean require cache
    delete require.cache[require.resolve(configFile)];

    try {
        config = require(configFile);
    } catch(e) {
        // Log it
        console.log(e);
        console.log('[-] Failed to reload config file, see above /\\');
        return;
    }

    // Loop over the servers we need
    for (let portString in config.portForwards) {
        let portNumber = parseInt(portString);
        
        // Validate port numbers
        if(isNaN(portNumber) || portNumber <= 0 || portNumber > 65535) continue;

        // Grab the config
        const thisConfig = config.portForwards[portString];

        if(currentServers.hasOwnProperty(portString)) {
            // Update the host and port
            currentServers[portString].host = thisConfig.host;
            currentServers[portString].port = thisConfig.port;
        } else {
            currentServers[portString] = {
                host: thisConfig.host,
                port: thisConfig.port,
            };

            // Create a new listener
            portForwardServer(portNumber);
        }
    }

    // Kill any servers we don't need anymore
    for(let portString in currentServers) {
        // Do we need to kill this server?
        if (!config.portForwards.hasOwnProperty(portString)) {
            const thisServerInfo = currentServers[portString];
            delete currentServers[portString];

            if(thisServerInfo.server) {
                // Close it
                thisServerInfo.server.close();

                console.log('[+] Stopped listening on port ' + portString);
            }

        }
    }
}

if (config.isGateway) {
    // Create a bunch of threads to improve response speed
    for (let i = 0; i < config.gatewayThreads; ++i) {
        portForwardClientLoop();
    }
} else {
    // Reload config
    refreshPortForwardServerConfig();

    // Monitor config, reload after a delay in MS
    fs.watch(configFile, setTimeout.bind(null, refreshPortForwardServerConfig, 100));
}