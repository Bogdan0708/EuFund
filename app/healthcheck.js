// Health check script for Docker container
const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 8080,
  path: '/api/health',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0); // Healthy
  } else {
    console.error(`Health check failed with status: ${res.statusCode}`);
    process.exit(1); // Unhealthy
  }
});

req.on('timeout', () => {
  console.error('Health check timed out');
  req.abort();
  process.exit(1);
});

req.on('error', (error) => {
  console.error(`Health check error: ${error.message}`);
  process.exit(1);
});

req.end();