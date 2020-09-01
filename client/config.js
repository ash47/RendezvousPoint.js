module.exports = {
	// Is this client a Gateway?
	isGateway: false,

	// Number of connections to have sitting in a pool ready for a connection
	gatewayThreads: 3,

	// Should we try every interface to reach the internet?
	tryAllInterfaces: true,
	
	// Configuration of where your RV Server is (on the internet hopefully)
	rvConfig: {
		host: '127.0.0.1',
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

	// Must match server, or ggwp
	psk: 'PutSomeKindOfAKeyHereToPreventHacking'
};