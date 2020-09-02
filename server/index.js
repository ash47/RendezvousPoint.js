const tls = require('tls');
const config = require('./config.js');

class PortForwardManager {
    constructor() {
        // Mappings
        this.mappings = {};
        this.currentListeners = {};

        // Contains all the socket connections that can be utilised
        this.socketQueueConnectMe = [];
        this.socketQueueConnectToMe = [];

        // Create the ingest server
        this.ingestServer = tls.createServer(config.tlsOptions, this.onIngestGetConnection.bind(this));
        this.ingestServer.on('error', this.onIngestServerError.bind(this));
        this.ingestServer.listen(config.ingestPort, this.onIngestServerBound.bind(this));
    }

    onIngestServerBound() {
        console.log('[+] Ingest server bound to port ' + config.ingestPort);
    }

    // Remove dead sockets from queue
    cleanupSocket(socket) {
        let didCleanup = false;

        // Connect Me Sockets
        for (let i = this.socketQueueConnectMe.length - 1; i >= 0; --i) {
            if (this.socketQueueConnectMe[i] === socket) {
                // Remove it
                this.socketQueueConnectMe.splice(i, 1);

                // We did cleanyup
                didCleanup = true;
            }
        }

        // Connect To Me Sockets
        for (let i = this.socketQueueConnectToMe.length - 1; i >= 0; --i) {
            if (this.socketQueueConnectToMe[i] === socket) {
                // Remove it
                this.socketQueueConnectToMe.splice(i, 1);

                // We did cleanup
                didCleanup = true;
            }
        }

        if(didCleanup) {
            // Log stats
            this.logConnectStats();
        }
    }

    publishStats(socket) {
        // Send the stats
        this.sendMessage(socket, {
            action: 'stats',
            stats: {
                totalConnectToMe: this.socketQueueConnectToMe.length,
                totalConnectMe: this.socketQueueConnectMe.length,
                connectToMeList: this.socketQueueConnectToMe.map((sock) => {
                    return {
                        hostname: sock.hostname,
                        ips: sock.ips,
                    }
                })
            }
        });
    }

    onIngestGetConnection(socket) {
        console.log('[+] Got an ingest socket');

        // Kill the socket after a delay
        const killIfNotAuthed = setTimeout(() => {
            console.log('[+] Client didnt auth fast enough');

            // Kill it
            socket.end();
        }, config.maxAuthTime);

        // Handle data
        socket.cachedData = Buffer.from([]);

        // Generic error handler to prevent crash
        socket.on('error', (err) => {
            this.cleanupSocket(socket);
        });

        // Handle an end event, will just remove socket from both queues
        socket.on('end', () => {
            this.cleanupSocket(socket);
        });

        socket.on('data', (data) => {
            // Merge new data onto the stack
            socket.cachedData = Buffer.concat([socket.cachedData, data]);

            // We need 4 bytes for the header
            if (socket.cachedData.length < 4) return;

            // How big is the message?
            const messageLen = socket.cachedData.readInt32BE(0);

            // No huge messages
            if (messageLen > 1024 * 1024) {
                socket.end();
                return;
            }

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
                return;
            }

            // Unhook data event
            socket.removeAllListeners('data');
            socket.pause();

            // Check PSK
            if(!niceMessage.hasOwnProperty('psk') || typeof(niceMessage.psk) !== 'string' || niceMessage.psk !== config.psk) {
                socket.end();
                return;
            }

            // We are now considered to be authed, kill timer
            clearTimeout(killIfNotAuthed);

            if (niceMessage.hasOwnProperty('action') && typeof (niceMessage.action) === 'string') {
                const thisAction = niceMessage.action;

                // Add the hostname
                if(niceMessage.hostname && typeof(niceMessage.hostname) === 'string') {
                    socket.hostname = niceMessage.hostname;
                } else {
                    socket.hostname = 'Unknown';
                }

                // Add the NIC IPs
                if(niceMessage.ips && Array.isArray(niceMessage.ips)) {
                    socket.ips = niceMessage.ips;
                } else {
                    socket.ips = [];
                }

                switch (thisAction) {
                    case 'connectMe':
                        console.log('[+] Got a connect me');
                        this.socketQueueConnectMe.push(socket);

                        // Is there a target we're looking for?
                        if(niceMessage.targetHostname && typeof(niceMessage.targetHostname) === 'string' && niceMessage.targetHostname.length > 0) {
                            socket.targetHostname = niceMessage.targetHostname;

                            console.log(socket.targetHostname);
                        }

                        // Publish stats
                        this.publishStats(socket);

                        // Actually try to link it
                        this.tryLinkSockets();
                        return;

                    case 'connectToMe':
                        console.log('[+] Got a connect to me from ' + socket.hostname);
                        this.socketQueueConnectToMe.push(socket);
                        this.tryLinkSockets();
                        return;

                    case 'stats':
                        // Publish stats
                        this.publishStats(socket);

                        // Kill socket
                        socket.end();
                        return;
                }
            }

            // Dead socket, kill it
            socket.end();
        });
    }

    onIngestServerError(err) {
        console.log(err);
        console.log('[-] Unhandled ingest server error /\\');
    }

    sendMessage(socket, dataObject) {
        // Convert the data object into a buffer, craete header
        const toSend = Buffer.from(JSON.stringify(dataObject));
        const header = Buffer.from([0,0,0,0]);

        // The header contains how big the message is, write it
        header.writeInt32BE(toSend.length);

        // Create a buffer with the final payload
        const finalBuff = Buffer.concat([header, toSend]);

        // Send it
        socket.write(finalBuff);
    }

    logConnectStats() {
        // Log current stats
        console.log('[+] ConnectToMe = ' + this.socketQueueConnectToMe.length + ', ConnectMe = ' + this.socketQueueConnectMe.length);
    }

    tryLinkSockets() {
        // Log stats
        this.logConnectStats();

        // We need at least one socket in each queue to make this work
        if(this.socketQueueConnectToMe.length <= 0 || this.socketQueueConnectMe.length <= 0) return;

        // Define our sockets
        let socketConnectToMe = null;
        let socketConnectMe = null;

        for(let i=0; i<this.socketQueueConnectMe.length; ++i) {
            const possibleSocketConnectMe = this.socketQueueConnectMe[i];

            // If there is no target hostname defined, take the first socket available
            if(!possibleSocketConnectMe.targetHostname) {
                // Store and remove it
                socketConnectMe = possibleSocketConnectMe;
                this.socketQueueConnectMe.splice(i, 1);

                socketConnectToMe = this.socketQueueConnectToMe.shift();
                break;
            } else {
                // We need to find a matching socket

                for(let j=0; j<this.socketQueueConnectToMe.length; ++j) {
                    const possibleSocketConnectToMe = this.socketQueueConnectToMe[j];

                    if(possibleSocketConnectMe.targetHostname.trim().toLowerCase() === possibleSocketConnectToMe.hostname.trim().toLowerCase()) {
                        socketConnectMe = possibleSocketConnectMe;
                        this.socketQueueConnectMe.splice(i, 1);

                        socketConnectToMe = possibleSocketConnectToMe;
                        this.socketQueueConnectToMe.splice(j, 1);
                        break;
                    }
                }

                // Did we find one?
                if(socketConnectMe && socketConnectToMe) {
                    break;
                } else {
                    console.log('[+] Host is trying to connect via a client called ' + possibleSocketConnectMe.targetHostname + ' but we have no connections from them :(');
                }
            }
        }

        // Check if we failed?
        if(!socketConnectMe || !socketConnectToMe) {
            // Failed to find a good match
            return;
        }

        // Handle errors for both sockets
        socketConnectToMe.on('error', () => {
            socketConnectMe.end();
        });

        socketConnectMe.on('error', () => {
            socketConnectToMe.end();
        });

        // Handle disconnect
        socketConnectToMe.on('end', () => {
            socketConnectMe.end();
        });

        socketConnectMe.on('end', () => {
            socketConnectToMe.end();
        });

        // Handle data pipes
        socketConnectToMe.pipe(socketConnectMe);
        socketConnectMe.pipe(socketConnectToMe);

        // Resume sockets
        socketConnectMe.resume();
        socketConnectToMe.resume();

        // Tell the "connect me" socket to send instructions
        this.sendMessage(socketConnectMe, {
            action: 'connected'
        });
    }
}

// Create the manager
new PortForwardManager();
