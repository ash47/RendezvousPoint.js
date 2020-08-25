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